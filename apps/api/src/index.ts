import { createApp } from './app.js';
import { configSchema } from './config.js';
import { createDatabase } from './database.js';
import { createServer } from 'node:http';
import { connectRedis } from '@aerqyn/simulation';
import { createRealtime } from './realtime.js';

const config = configSchema.safeParse(process.env);

if (!config.success) {
  console.error(
    'Invalid API configuration',
    config.error.issues.map((issue) => issue.path.join('.')),
  );
  process.exit(1);
}

const database = createDatabase(config.data.DATABASE_URL);
const redis = connectRedis(config.data.REDIS_URL);
const subscriber = connectRedis(config.data.REDIS_URL);
const server = createServer(createApp(database, config.data.JWT_SECRET, redis));
const realtime = createRealtime(
  server,
  database,
  config.data.JWT_SECRET,
  redis,
  subscriber,
);
// Liveness stays available during infrastructure outages; reconnect happens in the background.
void Promise.all([redis.connect(), subscriber.connect()])
  .then(() => realtime.start())
  .catch(() => console.error('Realtime startup unavailable'));
server.listen(config.data.API_PORT, '0.0.0.0', () => {
  console.info(`API listening on port ${config.data.API_PORT}`);
});

server.on('error', (error) => {
  console.error('API server failed', error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void realtime
      .close()
      .then(async () => {
        redis.destroy();
        subscriber.destroy();
        await database.$disconnect();
        process.exit(0);
      })
      .catch(() => process.exit(1));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
