import { Router } from 'express';
import { z } from 'zod';
import {
  stateKey,
  telemetrySchema,
  viewerCount,
  type Redis,
} from '@aerqyn/simulation';
import type { PrismaClient } from './generated/prisma/client.js';
import { ApiError } from './errors.js';
import { requireRole } from './auth.js';

export function missionId(value: unknown) {
  const result = z.uuid().safeParse(value);
  if (!result.success)
    throw new ApiError(400, 'VALIDATION_ERROR', 'A mission UUID is required');
  return result.data;
}

export async function latestTelemetry(
  database: PrismaClient,
  redis: Redis,
  id: string,
) {
  const mission = await database.mission.findUnique({ where: { id } });
  if (!mission) throw new ApiError(404, 'NOT_FOUND', 'Mission not found');
  const raw = await redis.get(stateKey(id));
  if (!raw) return null;
  const state = telemetrySchema.parse(JSON.parse(raw));
  return state.missionId === id &&
    mission.startedAt?.toISOString() === state.startedAt &&
    ['RUNNING', 'COMPLETED'].includes(mission.status)
    ? state
    : null;
}

export function simulationRoutes(database: PrismaClient, redis?: Redis) {
  const router = Router();
  for (const command of ['start', 'stop'] as const) {
    router.post(
      `/:id/${command}`,
      requireRole('RESEARCHER'),
      async (request, response) => {
        const id = missionId(request.params.id);
        if (!z.strictObject({}).safeParse(request.body ?? {}).success)
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            'Command body must be empty',
          );
        const result = await database.mission.updateMany({
          where: {
            id,
            status: command === 'start' ? { not: 'RUNNING' } : 'RUNNING',
          },
          data:
            command === 'start'
              ? { status: 'RUNNING', startedAt: new Date() }
              : { status: 'STOPPED' },
        });
        if (!result.count) {
          const exists = await database.mission.findUnique({ where: { id } });
          if (!exists)
            throw new ApiError(404, 'NOT_FOUND', 'Mission not found');
          throw new ApiError(
            409,
            'INVALID_STATE',
            command === 'start'
              ? 'Mission is already running'
              : 'Mission is not running',
          );
        }
        response.json({
          data: await database.mission.findUniqueOrThrow({ where: { id } }),
        });
      },
    );
  }
  router.get('/:id/telemetry', async (request, response) => {
    const id = missionId(request.params.id);
    if (!redis?.isReady)
      throw new ApiError(503, 'UNAVAILABLE', 'Telemetry service unavailable');
    response
      .set('Cache-Control', 'no-store')
      .json({ data: await latestTelemetry(database, redis, id) });
  });
  router.get('/:id/viewers', async (request, response) => {
    const id = missionId(request.params.id);
    if (!(await database.mission.findUnique({ where: { id } })))
      throw new ApiError(404, 'NOT_FOUND', 'Mission not found');
    if (!redis?.isReady)
      throw new ApiError(503, 'UNAVAILABLE', 'Viewer service unavailable');
    response
      .set('Cache-Control', 'no-store')
      .json({ data: { count: await viewerCount(redis, id) } });
  });
  return router;
}
