import { createServer } from 'node:http';
import { z } from 'zod';
import pg from 'pg';
import { connectRedis, redisUrlSchema } from '@aerqyn/simulation';
import { tick } from './simulator.js';
import { createAnomalyPipeline, rabbitUrlSchema } from './anomalies.js';
import { createJournal } from './journal.js';

const config = z
  .object({
    WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z
      .url()
      .refine((value) =>
        ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      ),
    REDIS_URL: redisUrlSchema.default('redis://127.0.0.1:6379'),
    RABBITMQ_URL: rabbitUrlSchema,
    EVENT_LOG_DIR: z.string().trim().min(1).default('.cache/events'),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error(
    'Invalid worker configuration',
    config.error.issues.map((issue) => issue.path.join('.')),
  );
  process.exit(1);
}

const journal = createJournal(config.data.EVENT_LOG_DIR);
try {
  await journal.record({ type: 'worker.started' });
} catch {
  console.error(
    'Worker event journal unavailable; check EVENT_LOG_DIR permissions',
  );
  process.exit(1);
}

const url = new URL(config.data.DATABASE_URL);
const schema = url.searchParams.get('schema') ?? 'public';
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
  throw new Error('Invalid database schema');
const pool = new pg.Pool({
  connectionString: url.href,
  connectionTimeoutMillis: 3000,
  options: `-c search_path=${schema}`,
});
pool.on('error', () => console.error('Worker database connection unavailable'));
const redis = connectRedis(config.data.REDIS_URL);
const anomalies = createAnomalyPipeline(
  pool,
  redis,
  config.data.RABBITMQ_URL,
  undefined,
  journal.record,
);
void redis
  .connect()
  .catch(() => console.error('Worker Redis startup unavailable'));
let stopping = false;
let pending = Promise.resolve();
let nextAnalysis = 0;
function schedule() {
  pending = (async () => {
    if (redis.isReady) {
      try {
        await tick(pool, redis, new Date(), journal.record);
        if (Date.now() >= nextAnalysis) {
          nextAnalysis = Date.now() + 1000;
          await anomalies.pump();
        }
      } catch {
        console.error('Worker cycle failed; retrying');
      }
    }
    if (!stopping) timer = setTimeout(schedule, 100);
  })();
}
let timer = setTimeout(schedule, 100);

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
  console.info(`Worker listening on port ${config.data.WORKER_PORT}`);
});

server.on('error', (error) => {
  console.error('Worker health server failed', error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true;
    clearTimeout(timer);
    server.close(() => {
      void pending
        .then(async () => {
          await anomalies.close();
          await journal.flush();
          redis.destroy();
          await pool.end();
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
