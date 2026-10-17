import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createJournal } from './journal.js';

const directories: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'aerqyn-journal-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it('rolls into a new UTC file at midnight', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const directory = await temporaryDirectory();
  const journal = createJournal(directory);
  vi.setSystemTime(new Date('2026-10-17T23:59:59Z'));
  await journal.record({ type: 'worker.started' });
  vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
  await journal.record({ type: 'worker.started' });
  expect((await readdir(directory)).sort()).toEqual([
    '2026-10-17.jsonl',
    '2026-10-18.jsonl',
  ]);
});

it('encodes multiline event data as one parseable JSONL record', async () => {
  const directory = await temporaryDirectory();
  await createJournal(directory).record({
    type: 'alert.detected',
    data: {
      id: '00000000-0000-4000-8000-000000000001',
      missionId: '00000000-0000-4000-8000-000000000002',
      startedAt: '2026-10-17T00:00:00Z',
      createdAt: '2026-10-17T00:00:01Z',
      droneId: 'drone-1',
      type: 'GPS_JUMP',
      message: 'First line\nSecond line',
    },
  });
  const [file] = await readdir(directory);
  const contents = await readFile(join(directory, file!), 'utf8');
  expect(contents.split('\n')).toHaveLength(2);
  expect(JSON.parse(contents).data.message).toBe('First line\nSecond line');
});

it('serializes concurrent writes and appends across journal restarts', async () => {
  const directory = await temporaryDirectory();
  const journal = createJournal(directory);
  await Promise.all(
    Array.from({ length: 30 }, () =>
      journal.record({ type: 'worker.started' }),
    ),
  );
  await createJournal(directory).record({ type: 'worker.started' });
  const files = await readdir(directory);
  expect(files.every((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))).toBe(
    true,
  );
  const contents = (
    await Promise.all(
      files.map((file) => readFile(join(directory, file), 'utf8')),
    )
  ).join('');
  const lines = contents.trim().split('\n');
  expect(lines).toHaveLength(31);
  for (const line of lines) {
    expect(JSON.parse(line)).toEqual({
      version: 1,
      timestamp: expect.stringMatching(/^\d{4}-.*Z$/),
      type: 'worker.started',
    });
  }
});

it('rejects unknown fields, preventing credentials from entering records', async () => {
  const journal = createJournal(await temporaryDirectory());
  expect(() =>
    journal.record({ type: 'worker.started', password: 'secret' } as never),
  ).toThrow();
});

it('reports filesystem failure and permits recovery on the next write', async () => {
  const parent = await temporaryDirectory();
  const directory = join(parent, 'events');
  await writeFile(directory, 'blocking file');
  const journal = createJournal(directory);
  await expect(journal.record({ type: 'worker.started' })).rejects.toThrow();
  await rm(directory);
  await expect(
    journal.record({ type: 'worker.started' }),
  ).resolves.toBeUndefined();
  await journal.flush();
});
