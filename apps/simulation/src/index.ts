import { z } from 'zod';
import { settingsSchema, type Telemetry } from './contracts.js';
export {
  settingsSchema,
  telemetrySchema,
  type Telemetry,
} from './contracts.js';
import { createClient } from 'redis';

export const redisUrlSchema = z
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol));
export function connectRedis(url: string) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 3000 },
  });
  client.on('error', () => console.error('Redis connection unavailable'));
  return client;
}
export type Redis = ReturnType<typeof connectRedis>;
export const telemetryChannel = 'aerqyn:telemetry';
export const stateKey = (id: string) => `aerqyn:mission:${id}:state`;
export const viewersKey = (id: string) => `aerqyn:mission:${id}:viewers`;
// Three offset square routes in a synthetic 100 x 100 field; speed is field units/s.
export function simulate(
  missionId: string,
  startedAt: Date,
  settings: z.infer<typeof settingsSchema>,
  now: Date,
): Telemetry {
  const elapsedMs = Math.min(
    settings.durationSeconds * 1000,
    Math.max(0, now.getTime() - startedAt.getTime()),
  );
  const completed = elapsedMs === settings.durationSeconds * 1000;
  const drones = ([0, 1, 2] as const).map((index) => {
    const distance = ((elapsedMs / 1000) * 5 + index * 40) % 240;
    const side = Math.floor(distance / 60);
    const offset = distance % 60;
    const points = [
      [20 + offset, 20],
      [80, 20 + offset],
      [80 - offset, 80],
      [20, 80 - offset],
    ];
    const [x, y] = points[side]!;
    return {
      id: `drone-${index + 1}` as 'drone-1' | 'drone-2' | 'drone-3',
      x: x!,
      y: y!,
      speed: completed ? 0 : 5,
      battery: Math.max(0, 100 - (elapsedMs / 1000) * 0.02),
      connectionStatus: 'CONNECTED' as const,
    };
  });
  return {
    missionId,
    startedAt: startedAt.toISOString(),
    timestamp: new Date(startedAt.getTime() + elapsedMs).toISOString(),
    elapsedMs,
    status: completed ? 'COMPLETED' : 'RUNNING',
    drones,
  };
}

export async function viewerCount(redis: Redis, id: string) {
  await redis.zRemRangeByScore(viewersKey(id), '-inf', Date.now());
  return redis.zCard(viewersKey(id));
}
