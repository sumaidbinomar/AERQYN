import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) {
  console.error(
    'Set DATABASE_URL in .env and start PostgreSQL before running integration tests.',
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
    ),
    'run',
    'apps/api/src/missions.integration.test.ts',
  ],
  {
    env: { ...process.env, AERQYN_INTEGRATION: '1' },
    stdio: 'inherit',
    windowsHide: true,
  },
);
process.exit(result.status ?? 1);
