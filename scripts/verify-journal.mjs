import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { journalEventSchema } from '../apps/worker/dist/journal.js';

function docker(args) {
  const result = spawnSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, 'Docker journal verification command failed');
  return result.stdout;
}
function readJournal() {
  return JSON.parse(
    docker([
      'exec',
      '-T',
      'worker',
      'node',
      '--input-type=module',
      '-e',
      `
    import { readdir, readFile, stat } from 'node:fs/promises';
    const root = process.env.EVENT_LOG_DIR;
    const files = await readdir(root);
    const entries = await Promise.all(files.filter(name => name.endsWith('.jsonl')).map(async name => ({
      name, text: await readFile(root + '/' + name, 'utf8'), mode: (await stat(root + '/' + name)).mode & 0o777
    })));
    console.log(JSON.stringify(entries));
  `,
    ]),
  );
}
const before = readJournal();
assert(before.length > 0, 'Expected daily log files');
const types = new Set();
const anomalies = new Set();
let count = 0;
for (const file of before) {
  assert.match(file.name, /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.equal(file.mode, 0o600, 'Event file must be private to worker');
  assert(file.text.endsWith('\n'), 'Each record must end with a newline');
  for (const line of file.text.trimEnd().split('\n')) {
    const { version, timestamp, ...event } = JSON.parse(line);
    assert.equal(version, 1);
    z.iso.datetime().parse(timestamp);
    assert.equal(timestamp.slice(0, 10), file.name.slice(0, 10));
    journalEventSchema.parse(event);
    types.add(event.type);
    if (event.type === 'alert.detected') anomalies.add(event.data.type);
    count++;
  }
}
for (const type of [
  'worker.started',
  'telemetry.snapshot',
  'anomaly.sample',
  'alert.detected',
])
  assert(types.has(type), `Missing ${type}; run smoke:simulation first`);
assert.equal(anomalies.size, 3, 'All three anomaly types must be recorded');
// Recreate the process/container while retaining its named volume.
docker([
  'up',
  '-d',
  '--no-deps',
  '--force-recreate',
  '--wait',
  '--wait-timeout',
  '60',
  'worker',
]);
const after = readJournal();
for (const file of before)
  assert(
    after.find((entry) => entry.name === file.name)?.text.startsWith(file.text),
    'Recreation must preserve every existing byte',
  );
assert(
  after.reduce((sum, file) => sum + file.text.length, 0) >
    before.reduce((sum, file) => sum + file.text.length, 0),
  'Restart must append a startup event',
);
console.info(
  `Journal verification passed: ${count} valid records, all event/anomaly types, private file permissions and byte-preserving container recreation.`,
);
