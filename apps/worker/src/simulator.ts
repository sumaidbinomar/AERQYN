import type { Pool } from 'pg';
import {
  settingsSchema,
  simulate,
  stateKey,
  telemetryChannel,
  type Redis,
} from '@aerqyn/simulation';
import { ignoreEvent, type JournalEvent, type RecordEvent } from './journal.js';

export async function tick(
  pool: Pool,
  redis: Redis,
  now = new Date(),
  record: RecordEvent = ignoreEvent,
) {
  const missions = await pool.query<{ id: string }>(
    'SELECT id FROM "Mission" WHERE status = \'RUNNING\'',
  );
  for (const { id } of missions.rows) {
    const connection = await pool.connect();
    let event: JournalEvent | undefined;
    try {
      await connection.query('BEGIN');
      // Lock the mission against concurrent stop/edit/delete and another worker tick.
      const result = await connection.query<{
        id: string;
        startedAt: Date | null;
        settings: unknown;
      }>(
        'SELECT id, "startedAt", settings FROM "Mission" WHERE id = $1 AND status = \'RUNNING\' FOR UPDATE SKIP LOCKED',
        [id],
      );
      const mission = result.rows[0];
      if (mission?.startedAt) {
        const settings = settingsSchema.parse(mission.settings);
        const elapsed = Math.max(
          0,
          now.getTime() - mission.startedAt.getTime(),
        );
        const completed = elapsed >= settings.durationSeconds * 1000;
        const frame = completed
          ? settings.durationSeconds * 1000
          : Math.floor(elapsed / settings.telemetryIntervalMs) *
            settings.telemetryIntervalMs;
        const state = simulate(
          id,
          mission.startedAt,
          settings,
          new Date(mission.startedAt.getTime() + frame),
        );
        const raw = JSON.stringify(state);
        if ((await redis.get(stateKey(id))) !== raw) {
          await redis
            .multi()
            .set(stateKey(id), raw, { EX: 7200 })
            .publish(telemetryChannel, raw)
            .exec();
        }
        // Keep at most one normal frame per five-second bucket, plus completion.
        const inserted = await connection.query(
          `INSERT INTO "TelemetrySnapshot" ("missionId", "startedAt", "elapsedMs", frame)
           SELECT $1, $2, $3, $4::jsonb WHERE NOT EXISTS (
             SELECT 1 FROM "TelemetrySnapshot" WHERE "missionId" = $1 AND "startedAt" = $2
             AND FLOOR("elapsedMs" / 5000.0) = FLOOR($3::integer / 5000.0)
           ) OR $5 ON CONFLICT DO NOTHING RETURNING "missionId"`,
          [id, mission.startedAt, state.elapsedMs, raw, completed],
        );
        if (inserted.rowCount)
          event = { type: 'telemetry.snapshot', data: state };
        if (completed)
          await connection.query(
            'UPDATE "Mission" SET status = \'COMPLETED\' WHERE id = $1',
            [id],
          );
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    // Log only committed snapshots. Filesystem failure must not undo database state.
    if (event) {
      try {
        await record(event);
      } catch {
        console.error(
          'Telemetry journal write failed; database snapshot retained',
        );
      }
    }
  }
}
