import { createApp } from './app.js';
import { configSchema } from './config.js';
import { createDatabase } from './database.js';

const config = configSchema.safeParse(process.env);

if (!config.success) {
  console.error(
    'Invalid API configuration',
    config.error.issues.map((issue) => issue.path.join('.')),
  );
  process.exit(1);
}

const database = createDatabase(config.data.DATABASE_URL);
const server = createApp(database).listen(
  config.data.API_PORT,
  '0.0.0.0',
  () => {
    console.info(`API listening on port ${config.data.API_PORT}`);
  },
);

server.on('error', (error) => {
  console.error('API server failed', error);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      database
        .$disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
