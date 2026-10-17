import { Router } from 'express';
import { z } from 'zod';
import { settingsSchema, simulate } from '@aerqyn/simulation';
import { injectionSchema, injectAnomaly } from '@aerqyn/simulation/anomalies';
import type { PrismaClient } from './generated/prisma/client.js';
import { requireRole } from './auth.js';
import { ApiError } from './errors.js';
import { missionId } from './simulation.js';

const paginationSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export function anomalyRoutes(database: PrismaClient) {
  const router = Router();
  router.post(
    '/:id/anomalies',
    requireRole('RESEARCHER'),
    async (request, response) => {
      const id = missionId(request.params.id);
      const command = injectionSchema.safeParse(request.body);
      if (!command.success)
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Provide a valid droneId and anomaly type only',
        );
      const job = await database.$transaction(async (transaction) => {
        // Same row lock as simulation ticks: stop/restart cannot race acceptance.
        await transaction.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id}::uuid FOR UPDATE`;
        const mission = await transaction.mission.findUnique({ where: { id } });
        if (!mission) throw new ApiError(404, 'NOT_FOUND', 'Mission not found');
        if (mission.status !== 'RUNNING' || !mission.startedAt)
          throw new ApiError(
            409,
            'INVALID_STATE',
            'Anomalies require a running mission',
          );
        const baseline = simulate(
          id,
          mission.startedAt,
          settingsSchema.parse(mission.settings),
          new Date(),
        );
        if (baseline.status !== 'RUNNING')
          throw new ApiError(
            409,
            'INVALID_STATE',
            'Mission duration has elapsed',
          );
        const pending = await transaction.anomalyJob.count({
          where: { missionId: id, processedAt: null },
        });
        if (pending >= 100)
          throw new ApiError(
            429,
            'QUEUE_FULL',
            'Mission has too many pending anomalies',
          );
        return transaction.anomalyJob.create({
          data: {
            missionId: id,
            startedAt: mission.startedAt,
            payload: {
              baseline,
              observed: injectAnomaly(baseline, command.data),
            },
          },
        });
      });
      response
        .status(202)
        .set('Cache-Control', 'no-store')
        .json({ data: { id: job.id, missionId: id, status: 'PENDING' } });
    },
  );
  router.get('/:id/alerts', async (request, response) => {
    const id = missionId(request.params.id);
    const query = paginationSchema.safeParse(request.query);
    if (!query.success)
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid alert pagination');
    if (!(await database.mission.findUnique({ where: { id } })))
      throw new ApiError(404, 'NOT_FOUND', 'Mission not found');
    const { limit, offset } = query.data;
    const alerts = await database.alert.findMany({
      where: { missionId: id },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      omit: { jobId: true },
    });
    response
      .set('Cache-Control', 'no-store')
      .json({ data: alerts, pagination: query.data });
  });
  return router;
}
