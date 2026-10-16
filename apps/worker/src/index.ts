import { createServer } from 'node:http';
import { z } from 'zod';

const config = z
  .object({
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error('Invalid worker configuration', z.flattenError(config.error));
  process.exit(1);
}

// A liveness endpoint keeps the scaffold running without inventing background jobs.
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && request.url === '/health') {
    response.end(JSON.stringify({ status: 'ok', service: 'worker' }));
    return;
  }
  response.statusCode = 404;
  response.end(
    JSON.stringify({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    }),
  );
});

server.listen(config.data.WORKER_PORT, '0.0.0.0', () => {
  console.info(`Worker scaffold listening on port ${config.data.WORKER_PORT}`);
});

server.on('error', (error) => {
  console.error('Worker health server failed', error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
