import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createDatabase } from './database.js';
import { configSchema } from './config.js';

const database = createDatabase(
  'postgresql://unused:unused@127.0.0.1:1/unused',
);
const app = createApp(database);
const id = '00000000-0000-4000-8000-000000000001';
afterAll(() => database.$disconnect());

describe('Mission input validation', () => {
  it.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(101) },
    { name: 'Demo', description: 'x'.repeat(2001) },
    { name: 'Demo', status: 'RUNNING' },
    { name: 'Demo', settings: { droneCount: 4 } },
    { name: 'Demo', settings: { durationSeconds: 0 } },
    { name: 'Demo', settings: { telemetryIntervalMs: 99 } },
    { name: 'Demo', settings: null },
  ])(
    'rejects invalid create body %j before querying the database',
    async (body) => {
      const response = await request(app).post('/missions').send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );
  it.each([
    {},
    { status: 'RUNNING' },
    { name: null },
    { settings: { durationSeconds: 1.5 } },
  ])('rejects invalid update %j', async (body) => {
    const response = await request(app).patch(`/missions/${id}`).send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
  it.each(['get', 'patch', 'delete'] as const)(
    'rejects malformed IDs on %s',
    async (method) => {
      const client = request(app);
      const response = await client[method]('/missions/not-a-uuid').send({
        name: 'Demo',
      });
      expect(response.status).toBe(400);
    },
  );
  it.each([
    'limit=0',
    'limit=101',
    'offset=-1',
    'limit=abc',
    'limit=1&limit=2',
    'unknown=true',
  ])('rejects invalid pagination %s', async (query) => {
    expect((await request(app).get(`/missions?${query}`)).status).toBe(400);
  });
  it('handles malformed JSON consistently', async () => {
    const response = await request(app)
      .post('/missions')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });
  it('limits request body size', async () => {
    const response = await request(app)
      .post('/missions')
      .send({ name: 'x'.repeat(17000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('does not expose internal database errors', async () => {
    const failure = vi
      .spyOn(database.mission, 'findMany')
      .mockRejectedValueOnce(new Error('private connection credentials'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app).get('/missions');
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally {
      failure.mockRestore();
      log.mockRestore();
    }
  });
  it.each([undefined, 'https://localhost/db', 'postgresql://localhost'])(
    'rejects invalid database configuration %s',
    (DATABASE_URL) => {
      expect(configSchema.safeParse({ DATABASE_URL }).success).toBe(false);
    },
  );
});
