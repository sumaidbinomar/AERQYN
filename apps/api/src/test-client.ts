import request from 'supertest';
import { SignJWT } from 'jose';
import type { Express } from 'express';

export const testSecret = 'test-only-secret-01234567890123456789';
export const testUserId = '00000000-0000-4000-8000-000000000002';

export function testToken() {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(testUserId)
    .setIssuer('aerqyn-api')
    .setAudience('aerqyn')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(testSecret));
}

export function missionClient(app: Express, token: string) {
  const client = request(app);
  return {
    get: (path: string) => client.get(path).auth(token, { type: 'bearer' }),
    post: (path: string) => client.post(path).auth(token, { type: 'bearer' }),
    patch: (path: string) => client.patch(path).auth(token, { type: 'bearer' }),
    delete: (path: string) =>
      client.delete(path).auth(token, { type: 'bearer' }),
  };
}
