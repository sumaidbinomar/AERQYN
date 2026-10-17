import type { Pool } from 'pg';
import {
  settingsSchema,
  simulate,
  stateKey,
  telemetryChannel,
  type Redis,
} from '@aerqyn/simulation';

export async function tick(pool: Pool, redis: Redis, now = new Date()) {
  const missions = await pool.query<{ id: string }>(
    'SELECT id FROM "Mission" WHERE status = \'RUNNING\'',
  );
  for (const { id } of missions.rows) {
    const connection = await pool.connect();
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
        await connection.query(
          `INSERT INTO "TelemetrySnapshot" ("missionId", "startedAt", "elapsedMs", frame)
           SELECT $1, $2, $3, $4::jsonb WHERE NOT EXISTS (
             SELECT 1 FROM "TelemetrySnapshot" WHERE "missionId" = $1 AND "startedAt" = $2
             AND FLOOR("elapsedMs" / 5000.0) = FLOOR($3::integer / 5000.0)
           ) OR $5 ON CONFLICT DO NOTHING`,
          [id, mission.startedAt, state.elapsedMs, raw, completed],
        );
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
  }
}
