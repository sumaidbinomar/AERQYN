import { z } from 'zod';
import { createApp } from './app.js';

const config = z
  .object({ API_PORT: z.coerce.number().int().min(1).max(65535).default(3000) })
  .safeParse(process.env);

if (!config.success) {
  console.error('Invalid API configuration', z.flattenError(config.error));
  process.exit(1);
}

const server = createApp().listen(config.data.API_PORT, '0.0.0.0', () => {
  console.info(`API listening on port ${config.data.API_PORT}`);
});

server.on('error', (error) => {
  console.error('API server failed', error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
