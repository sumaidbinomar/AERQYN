import { z } from 'zod';

export const configSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname && url.pathname.length > 1)
    );
  }, 'Expected a PostgreSQL connection URL'),
});
