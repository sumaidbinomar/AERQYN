import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { createDatabase } from './database.js';
import {
  missionClient,
  testSecret,
  testToken,
  testUserId,
} from './test-client.js';

const database = createDatabase(
  'postgresql://unused:unused@127.0.0.1:1/unused',
);
const app = createApp(database, testSecret);
const token = await testToken();
const client = missionClient(app, token);
const id = '00000000-0000-4000-8000-000000000001';
const user = {
  id: testUserId,
  email: 'test@example.com',
  passwordHash: '',
  role: 'RESEARCHER' as const,
};
const lookup = vi.spyOn(database.user, 'findUnique');
const update = vi.spyOn(database.mission, 'updateMany');
const find = vi.spyOn(database.mission, 'findUnique');
beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue(user);
});
afterAll(() => database.$disconnect());
it.each(['start', 'stop'])(
  'protects %s commands and rejects Observer writes',
  async (command) => {
    expect((await request(app).post(`/missions/${id}/${command}`)).status).toBe(
      401,
    );
    lookup.mockResolvedValue({ ...user, role: 'OBSERVER' });
    expect((await client.post(`/missions/${id}/${command}`)).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  },
);
it('validates command IDs and bodies before writes', async () => {
  expect((await client.post('/missions/bad/start')).status).toBe(400);
  expect(
    (await client.post(`/missions/${id}/start`).send({ droneCount: 4 })).status,
  ).toBe(400);
  expect(update).not.toHaveBeenCalled();
});
it('returns 404 for missing missions and 409 for invalid transitions', async () => {
  update.mockResolvedValue({ count: 0 });
  find.mockResolvedValue(null);
  expect((await client.post(`/missions/${id}/start`)).status).toBe(404);
  find.mockResolvedValue({
    id,
    name: 'test',
    description: '',
    createdAt: new Date(),
    startedAt: new Date(),
    status: 'RUNNING',
    settings: {},
  });
  expect((await client.post(`/missions/${id}/start`)).status).toBe(409);
});
it('returns 503 when Redis is unavailable', async () => {
  expect((await client.get(`/missions/${id}/telemetry`)).status).toBe(503);
});
it('protects anomaly injection and alert history', async () => {
  expect((await request(app).post(`/missions/${id}/anomalies`)).status).toBe(
    401,
  );
  expect((await request(app).get(`/missions/${id}/alerts`)).status).toBe(401);
  lookup.mockResolvedValue({ ...user, role: 'OBSERVER' });
  expect(
    (
      await client
        .post(`/missions/${id}/anomalies`)
        .send({ droneId: 'drone-1', type: 'GPS_JUMP' })
    ).status,
  ).toBe(403);
});
it.each([
  {},
  { droneId: 'drone-4', type: 'GPS_JUMP' },
  { droneId: 'drone-1', type: 'REAL_ATTACK' },
  { droneId: 'drone-1', type: 'GPS_JUMP', x: 100000 },
])('rejects invalid anomaly commands %j', async (body) => {
  expect(
    (await client.post(`/missions/${id}/anomalies`).send(body)).status,
  ).toBe(400);
});
it('validates alert pagination and reports missing missions', async () => {
  expect((await client.get(`/missions/${id}/alerts?limit=101`)).status).toBe(
    400,
  );
  expect((await client.get(`/missions/${id}/alerts?extra=1`)).status).toBe(400);
  find.mockResolvedValue(null);
  expect((await client.get(`/missions/${id}/alerts`)).status).toBe(404);
});
it('protects replay and validates its run selector', async () => {
  expect((await request(app).get(`/missions/${id}/replay`)).status).toBe(401);
  expect((await client.get('/missions/bad/replay')).status).toBe(400);
  expect(
    (await client.get(`/missions/${id}/replay?startedAt=bad`)).status,
  ).toBe(400);
  expect((await client.get(`/missions/${id}/replay?extra=1`)).status).toBe(400);
  find.mockResolvedValue(null);
  expect((await client.get(`/missions/${id}/replay`)).status).toBe(404);
});
