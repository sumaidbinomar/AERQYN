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
