import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function start(args, env, cwd = root) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  child.stderr.on('data', (data) => {
    output += data.toString();
  });
  child.on('error', (error) => {
    output += error.message;
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const entry = { child, closed, output: () => output };
  children.push(entry);
  return entry;
}

async function waitFor(url, entry) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) {
      throw new Error(
        `Process exited before becoming healthy: ${entry.output()}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch {
      // The process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${entry.output()}`);
}

try {
  const apiPort = await freePort();
  const api = start(['apps/api/dist/index.js'], {
    API_PORT: String(apiPort),
    JWT_SECRET: 'smoke-only-secret-01234567890123456789',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  });
  const apiResponse = await waitFor(`http://127.0.0.1:${apiPort}/health`, api);
  assert.deepEqual(await apiResponse.json(), { status: 'ok', service: 'api' });
  assert.equal(
    (await fetch(`http://127.0.0.1:${apiPort}/missions`)).status,
    401,
  );

  const workerPort = await freePort();
  const worker = start(['apps/worker/dist/index.js'], {
    WORKER_PORT: String(workerPort),
  });
  const workerUrl = `http://127.0.0.1:${workerPort}`;
  assert.deepEqual(
    await (await waitFor(`${workerUrl}/health`, worker)).json(),
    { status: 'ok', service: 'worker' },
  );
  assert.equal((await fetch(`${workerUrl}/unknown`)).status, 404);

  const webPort = await freePort();
  const web = start(
    [
      fileURLToPath(
        new URL('../node_modules/vite/bin/vite.js', import.meta.url),
      ),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    { API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
    fileURLToPath(new URL('../apps/web', import.meta.url)),
  );
  const webUrl = `http://127.0.0.1:${webPort}`;
  assert.match(
    await (await waitFor(webUrl, web)).text(),
    /<title>AERQYN<\/title>/,
  );
  const proxyResponse = await fetch(`${webUrl}/api/health`);
  assert.equal(proxyResponse.status, 200);
  assert.deepEqual(await proxyResponse.json(), {
    status: 'ok',
    service: 'api',
  });
  assert.equal((await fetch(`${webUrl}/api/missions`)).status, 401);

  for (const [service, variable] of [
    ['api', 'API_PORT'],
    ['worker', 'WORKER_PORT'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [`apps/${service}/dist/index.js`],
      {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
          JWT_SECRET: 'smoke-only-secret-01234567890123456789',
          [variable]: 'invalid',
        },
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid .* configuration/);
  }
  console.info(
    'Smoke checks passed: API, worker, web preview, API proxy, protected missions, and invalid port rejection.',
  );
} finally {
  for (const { child } of children) child.kill();
  await Promise.all(children.map(({ closed }) => closed));
}
