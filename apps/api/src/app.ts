import express from 'express';
import type { PrismaClient } from './generated/prisma/client.js';
import { errorHandler } from './errors.js';
import { missionRoutes } from './missions.js';
import { createAuth } from './auth.js';
import { simulationRoutes } from './simulation.js';
import type { Redis } from '@aerqyn/simulation';
import { anomalyRoutes } from './anomalies.js';

export function createApp(
  database: PrismaClient,
  jwtSecret: string,
  redis?: Redis,
) {
  const app = express();
  const auth = createAuth(database, jwtSecret);
  app.disable('x-powered-by');

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'api' });
  });

  app.use(express.json({ limit: '16kb' }));
  app.use('/auth', auth.router);
  app.use(
    '/missions',
    auth.authenticate,
    anomalyRoutes(database),
    simulationRoutes(database, redis),
    missionRoutes(database),
  );

  app.use((_request, response) => {
    response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}
