import { z } from 'zod';
import { jwtSecretSchema } from './auth.js';
import { redisUrlSchema } from '@aerqyn/simulation';

export const configSchema = z.object({
  JWT_SECRET: jwtSecretSchema,
  REDIS_URL: redisUrlSchema.default('redis://127.0.0.1:6379'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname && url.pathname.length > 1)
    );
  }, 'Expected a PostgreSQL connection URL'),
});
