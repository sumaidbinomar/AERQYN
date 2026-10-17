import express from 'express';
import type { PrismaClient } from './generated/prisma/client.js';
import { errorHandler } from './errors.js';
import { missionRoutes } from './missions.js';

export function createApp(database: PrismaClient) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'api' });
  });

  app.use(express.json({ limit: '16kb' }));
  app.use('/missions', missionRoutes(database));

  app.use((_request, response) => {
    response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);
  return app;
}
