import { randomUUID } from 'node:crypto';
import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { Pool } from 'pg';
import { z } from 'zod';
import { telemetryChannel, type Redis } from '@aerqyn/simulation';
import {
  alertChannel,
  alertSchema,
  analysisSchema,
  detectAnomalies,
} from '@aerqyn/simulation/anomalies';

export const rabbitUrlSchema = z
  .url()
  .refine((value) => ['amqp:', 'amqps:'].includes(new URL(value).protocol));
const messageSchema = z.strictObject({ jobId: z.uuid() });

// A mission lock serializes processing with stop/restart and deletion.
export async function analyzeJob(pool: Pool, jobId: string) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const lookup = await connection.query<{ missionId: string }>(
      'SELECT "missionId" FROM "AnomalyJob" WHERE id = $1',
      [jobId],
    );
    const id = lookup.rows[0]?.missionId;
    if (id) {
      const missions = await connection.query<{
        status: string;
        startedAt: Date;
      }>('SELECT status, "startedAt" FROM "Mission" WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      const jobs = await connection.query<{
        payload: unknown;
        startedAt: Date;
        processedAt: Date | null;
      }>(
        'SELECT payload, "startedAt", "processedAt" FROM "AnomalyJob" WHERE id = $1 FOR UPDATE',
        [jobId],
      );
      const job = jobs.rows[0];
      const mission = missions.rows[0];
      if (job && !job.processedAt) {
        const parsed = analysisSchema.safeParse(job.payload);
        let outcome = 'STALE';
        if (!parsed.success) outcome = 'INVALID';
        else if (
          mission?.status === 'RUNNING' &&
          mission.startedAt.toISOString() === job.startedAt.toISOString()
        ) {
          const { baseline, observed } = parsed.data;
          if (
            baseline.missionId !== id ||
            observed.missionId !== id ||
            baseline.startedAt !== job.startedAt.toISOString() ||
            observed.startedAt !== baseline.startedAt
          )
            outcome = 'INVALID';
          else {
            for (const finding of detectAnomalies(baseline, observed)) {
              await connection.query(
                'INSERT INTO "Alert" (id, "jobId", "missionId", "startedAt", "droneId", type, message) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
                [
                  randomUUID(),
                  jobId,
                  id,
                  job.startedAt,
                  finding.droneId,
                  finding.type,
                  finding.message,
                ],
              );
            }
            outcome = 'ANALYZED';
          }
        }
        await connection.query(
          'UPDATE "AnomalyJob" SET "processedAt" = now(), outcome = $2 WHERE id = $1',
          [jobId, outcome],
        );
      }
    }
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

export async function notifyAlerts(pool: Pool, redis: Redis) {
  const jobs = await pool.query<{
    id: string;
    missionId: string;
    startedAt: Date;
    payload: unknown;
    outcome: string;
  }>(
    'SELECT id, "missionId", "startedAt", payload, outcome FROM "AnomalyJob" WHERE "processedAt" IS NOT NULL AND "notifiedAt" IS NULL ORDER BY "createdAt" LIMIT 50',
  );
  for (const job of jobs.rows) {
    const missions = await pool.query<{ status: string; startedAt: Date }>(
      'SELECT status, "startedAt" FROM "Mission" WHERE id = $1',
      [job.missionId],
    );
    const mission = missions.rows[0];
    if (
      job.outcome === 'ANALYZED' &&
      mission?.status === 'RUNNING' &&
      mission.startedAt.toISOString() === job.startedAt.toISOString()
    ) {
      // Anomaly samples retain their original timestamp; never replace the latest normal cache with an older frame.
      const { observed } = analysisSchema.parse(job.payload);
      await redis.publish(telemetryChannel, JSON.stringify(observed));
      const alerts = await pool.query<{
        id: string;
        missionId: string;
        startedAt: Date;
        droneId: string;
        type: string;
        message: string;
        createdAt: Date;
      }>(
        'SELECT id, "missionId", "startedAt", "droneId", type, message, "createdAt" FROM "Alert" WHERE "jobId" = $1',
        [job.id],
      );
      for (const alert of alerts.rows) {
        const event = alertSchema.parse({
          ...alert,
          startedAt: alert.startedAt.toISOString(),
          createdAt: alert.createdAt.toISOString(),
        });
        await redis.publish(alertChannel, JSON.stringify(event));
      }
    }
    await pool.query(
      'UPDATE "AnomalyJob" SET "notifiedAt" = now() WHERE id = $1',
      [job.id],
    );
  }
}

export function createAnomalyPipeline(
  pool: Pool,
  redis: Redis,
  url: string,
  queue = 'aerqyn.anomaly-analysis',
) {
  let connection: ChannelModel | undefined;
  let channel: ConfirmChannel | undefined;
  let closed = false;
  let nextConnectAt = 0;
  let consuming = Promise.resolve();
  let consumerTag: string | undefined;
  async function ensureConnection() {
    if (channel || closed || Date.now() < nextConnectAt) return;
    nextConnectAt = Date.now() + 5000;
    const active = await connect(url, { timeout: 3000 });
    connection = active;
    active.on('error', () => console.error('RabbitMQ connection unavailable'));
    active.on('close', () => {
      if (connection === active) {
        channel = undefined;
        connection = undefined;
      }
    });
    try {
      const consumer = await active.createConfirmChannel();
      consumer.on('error', () => console.error('RabbitMQ channel unavailable'));
      consumer.on('close', () => {
        if (channel === consumer) channel = undefined;
        void active.close().catch(() => {});
      });
      await consumer.assertQueue(`${queue}.dead`, { durable: true });
      await consumer.assertQueue(queue, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': `${queue}.dead`,
        },
      });
      await consumer.prefetch(1);
      const subscription = await consumer.consume(
        queue,
        (message) => {
          if (!message) {
            void active.close().catch(() => {});
            return;
          }
          consuming = consuming
            .then(async () => {
              let parsed: z.infer<typeof messageSchema>;
              try {
                if (message.content.length > 1024)
                  throw new Error('Oversized job');
                parsed = messageSchema.parse(
                  JSON.parse(message.content.toString('utf8')),
                );
              } catch {
                consumer.nack(message, false, false);
                return;
              }
              try {
                await analyzeJob(pool, parsed.jobId);
              } catch {
                // The durable database outbox retries after five seconds, avoiding hot requeue loops.
                console.error(
                  'Anomaly analysis failed; durable job will retry',
                );
              }
              consumer.ack(message);
            })
            .catch(() =>
              console.error(
                'Anomaly acknowledgement unavailable; broker will redeliver',
              ),
            );
        },
        { noAck: false },
      );
      consumerTag = subscription.consumerTag;
      channel = consumer;
    } catch (error) {
      await active.close().catch(() => {});
      throw error;
    }
  }
  return {
    async pump() {
      await notifyAlerts(pool, redis);
      await ensureConnection();
      const producer = channel;
      if (!producer) return;
      const jobs = await pool.query<{ id: string }>(
        'SELECT id FROM "AnomalyJob" WHERE "processedAt" IS NULL AND "nextPublishAt" <= now() ORDER BY "createdAt" LIMIT 50',
      );
      for (const job of jobs.rows) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('RabbitMQ confirmation timed out'));
            void connection?.close().catch(() => {});
          }, 5000);
          producer.sendToQueue(
            queue,
            Buffer.from(JSON.stringify({ jobId: job.id })),
            {
              persistent: true,
              contentType: 'application/json',
              messageId: job.id,
            },
            (error: unknown) => {
              clearTimeout(timeout);
              if (error) reject(error);
              else resolve();
            },
          );
        });
        await pool.query(
          'UPDATE "AnomalyJob" SET "nextPublishAt" = now() + interval \'5 seconds\' WHERE id = $1',
          [job.id],
        );
      }
    },
    async close() {
      closed = true;
      if (channel && consumerTag) await channel.cancel(consumerTag);
      await consuming;
      await connection?.close();
    },
  };
}
