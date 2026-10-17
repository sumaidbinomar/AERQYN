import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const database = createDatabase(
  'postgresql://unused:unused@127.0.0.1:1/unused',
);

describe('API foundation', () => {
  it('reports process health without exposing implementation headers', async () => {
    const response = await request(
      createApp(database, 'test-only-secret-01234567890123456789'),
    ).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'api' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a JSON 404 for routes outside the scaffold', async () => {
    const response = await request(
      createApp(database, 'test-only-secret-01234567890123456789'),
    ).get('/unknown');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });
});
