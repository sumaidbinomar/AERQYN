import { appendFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { telemetrySchema } from '@aerqyn/simulation';
import { alertSchema } from '@aerqyn/simulation/anomalies';

// Only known simulation data can enter the journal. Never pass requests or errors.
export const journalEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('telemetry.snapshot'),
    data: telemetrySchema,
  }),
  z.strictObject({ type: z.literal('anomaly.sample'), data: telemetrySchema }),
  z.strictObject({ type: z.literal('alert.detected'), data: alertSchema }),
  z.strictObject({ type: z.literal('worker.started') }),
]);
export type JournalEvent = z.infer<typeof journalEventSchema>;
export type RecordEvent = (event: JournalEvent) => Promise<void>;
export const ignoreEvent: RecordEvent = async () => {};

export function createJournal(directory: string) {
  const root = resolve(directory);
  let pending = Promise.resolve();
  const record: RecordEvent = (input) => {
    // Validate before queuing; JSON encoding keeps embedded newlines on one line.
    const event = journalEventSchema.parse(input);
    const timestamp = new Date().toISOString();
    const line = JSON.stringify({ version: 1, timestamp, ...event }) + '\n';
    const write = pending.then(async () => {
      await mkdir(root, { recursive: true });
      await appendFile(join(root, `${timestamp.slice(0, 10)}.jsonl`), line, {
        encoding: 'utf8',
        mode: 0o600,
      });
    });
    // A failed write rejects its caller but does not poison subsequent writes.
    pending = write.catch(() => {});
    return write;
  };
  return { record, flush: () => pending };
}
