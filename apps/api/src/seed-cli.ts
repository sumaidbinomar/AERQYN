import { createDatabase } from './database.js';
import { seedDemoUsers } from './seed.js';
import { configSchema } from './config.js';

async function main() {
  const url = configSchema.shape.DATABASE_URL.parse(process.env.DATABASE_URL);
  const database = createDatabase(url);
  try {
    await seedDemoUsers(database, process.env);
    console.info('Demo Researcher and Observer accounts seeded');
  } finally {
    await database.$disconnect();
  }
}

await main().catch(() => {
  console.error(
    'Demo seeding failed. Check database connectivity and DEMO_* configuration; passwords must be 12–128 characters and emails must differ.',
  );
  process.exitCode = 1;
});
