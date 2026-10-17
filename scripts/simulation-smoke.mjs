import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

// Targets the running stack through the web proxy; never prints credentials or JWTs.
const origin =
  process.env.SIMULATION_ORIGIN ??
  `http://127.0.0.1:${process.env.WEB_PORT ?? 5173}`;
const sockets = [];
const ids = [];
let researcher;
async function api(path, token, method = 'GET', body) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const result = response.status === 204 ? null : await response.json();
  return { status: response.status, ...result };
}
async function login(role) {
  const result = await api('/auth/login', undefined, 'POST', {
    email:
      process.env[`DEMO_${role}_EMAIL`] ?? `${role.toLowerCase()}@aerqyn.local`,
    password: process.env[`DEMO_${role}_PASSWORD`],
  });
  assert.equal(result.status, 200, `${role} login`);
  return result.data.accessToken;
}
async function connect(token, missionId, transport) {
  const socket = io(origin, {
    auth: { token },
    transports: [transport],
    reconnection: false,
    timeout: 5000,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const result = await socket
    .timeout(5000)
    .emitWithAck('mission:join', { missionId });
  assert.equal(result.data?.missionId, missionId);
  return socket;
}
async function waitUntil(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for simulation state');
}
try {
  researcher = await login('RESEARCHER');
  const observer = await login('OBSERVER');
  for (let index = 0; index < 2; index++) {
    const result = await api('/missions', researcher, 'POST', {
      name: `M5 smoke ${index}`,
      settings: { durationSeconds: 10, telemetryIntervalMs: 100 },
    });
    assert.equal(result.status, 201);
    ids.push(result.data.id);
  }
  const [id, other] = ids;
  assert.equal(
    (await api(`/missions/${id}/start`, observer, 'POST')).status,
    403,
  );
  const a = await connect(researcher, id, 'websocket');
  const b = await connect(observer, id, 'polling');
  const c = await connect(observer, other, 'websocket');
  const frames = [[], [], []];
  const alerts = [[], [], []];
  [a, b, c].forEach((socket, index) =>
    socket.on('alert', (alert) => alerts[index].push(alert)),
  );
  [a, b, c].forEach((socket, index) =>
    socket.on('telemetry', (frame) => frames[index].push(frame)),
  );
  assert.equal((await api(`/missions/${id}/viewers`, observer)).data.count, 2);
  assert.equal(
    (await api(`/missions/${id}/start`, researcher, 'POST')).status,
    200,
  );
  await waitUntil(() => frames[0].length >= 2 && frames[1].length >= 2);
  assert.equal(frames[2].length, 0);
  for (const frame of [...frames[0], ...frames[1]]) {
    assert.equal(frame.missionId, id);
    assert.equal(frame.drones.length, 3);
  }
  assert.notEqual(frames[0][0].drones[0].x, frames[0].at(-1).drones[0].x);
  assert.equal(
    (await api(`/missions/${id}/telemetry`, observer)).data.missionId,
    id,
  );
  const command = { droneId: 'drone-2', type: 'GPS_JUMP' };
  assert.equal(
    (await api(`/missions/${id}/anomalies`, undefined, 'POST', command)).status,
    401,
  );
  assert.equal(
    (await api(`/missions/${id}/anomalies`, observer, 'POST', command)).status,
    403,
  );
  for (const type of ['GPS_JUMP', 'BATTERY_DROP', 'COMMUNICATION_LOSS']) {
    assert.equal(
      (
        await api(`/missions/${id}/anomalies`, researcher, 'POST', {
          ...command,
          type,
        })
      ).status,
      202,
    );
  }
  await waitUntil(() => alerts[0].length >= 3 && alerts[1].length >= 3);
  assert.equal(alerts[2].length, 0);
  assert.equal(new Set(alerts[0].map((alert) => alert.type)).size, 3);
  const history = await api(`/missions/${id}/alerts`, observer);
  assert.equal(history.status, 200);
  assert.equal(history.data.length, 3);
  assert.deepEqual(
    new Set(history.data.map((alert) => alert.id)),
    new Set(alerts[0].map((alert) => alert.id)),
  );
  assert(
    frames[0].some(
      (frame) => frame.drones[1].connectionStatus === 'DISCONNECTED',
    ),
  );
  assert.equal(
    (await api(`/missions/${id}/stop`, researcher, 'POST')).status,
    200,
  );
  assert.equal((await api(`/missions/${id}/telemetry`, observer)).data, null);
  assert.equal(
    (await api(`/missions/${id}/start`, researcher, 'POST')).status,
    200,
  );
  await waitUntil(
    async () =>
      (await api(`/missions/${id}`, observer)).data.status === 'COMPLETED',
  );
  assert.equal(
    (await api(`/missions/${id}/telemetry`, observer)).data.status,
    'COMPLETED',
  );
  assert.equal((await api(`/missions/${id}/replay`)).status, 401);
  const replay = await api(`/missions/${id}/replay`, observer);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.runs.length, 2);
  assert(replay.data.frames.length >= 2);
  assert.equal(replay.data.frames.at(-1).status, 'COMPLETED');
  assert(
    replay.data.frames.every(
      (frame) => frame.startedAt === replay.data.runs[0],
    ),
  );
  const oldReplay = await api(
    `/missions/${id}/replay?startedAt=${encodeURIComponent(replay.data.runs[1])}`,
    observer,
  );
  assert(oldReplay.data.frames.length >= 1);
  assert(
    oldReplay.data.frames.every(
      (frame) => frame.startedAt === replay.data.runs[1],
    ),
  );
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert((await page.text()).includes('Virtual Flight Laboratory'));
  b.disconnect();
  await waitUntil(
    async () =>
      (await api(`/missions/${id}/viewers`, observer)).data.count === 1,
  );
  console.info(
    'Live simulation/anomaly smoke passed: proxied WebSocket and polling clients, room isolation, RBAC, movement, cache, three anomaly types, durable alerts, stop/restart/completion, recorded runs, frontend HTML, and viewer cleanup.',
  );
} finally {
  sockets.forEach((socket) => socket.disconnect());
  if (researcher)
    for (const id of ids) {
      await api(`/missions/${id}/stop`, researcher, 'POST');
      assert.equal(
        (await api(`/missions/${id}`, researcher, 'DELETE')).status,
        204,
      );
    }
}
