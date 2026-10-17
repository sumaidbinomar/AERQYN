import request from 'supertest';
import { SignJWT } from 'jose';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { configSchema } from './config.js';
import { createDatabase } from './database.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { seedSchema } from './seed.js';
import { testSecret, testToken, testUserId } from './test-client.js';

const database = createDatabase(
  'postgresql://unused:unused@127.0.0.1:1/unused',
);
const password = 'a private test password';
const passwordHash = await hashPassword(password);
const user = {
  id: testUserId,
  email: 'researcher@test.local',
  passwordHash,
  role: 'RESEARCHER' as const,
};
const lookup = vi.spyOn(database.user, 'findUnique');
const token = await testToken();
const app = createApp(database, testSecret);
beforeEach(() => {
  lookup.mockReset();
  lookup.mockResolvedValue(user);
});
afterAll(() => database.$disconnect());

describe('Password storage and seed configuration', () => {
  it('salts password hashes and verifies only the correct password', async () => {
    expect(await hashPassword(password)).not.toBe(passwordHash);
    expect(passwordHash).not.toContain(password);
    expect(await verifyPassword(password, passwordHash)).toBe(true);
    expect(await verifyPassword('wrong password', passwordHash)).toBe(false);
    expect(await verifyPassword(password, 'broken hash')).toBe(false);
  });
  it.each([undefined, 'short', 'replace_with_at_least_32_random_characters'])(
    'rejects missing/weak/placeholder JWT secret %s',
    (JWT_SECRET) => {
      expect(
        configSchema.safeParse({
          JWT_SECRET,
          DATABASE_URL: 'postgresql://localhost/test',
        }).success,
      ).toBe(false);
    },
  );
  it('accepts valid startup configuration', () => {
    expect(
      configSchema.safeParse({
        JWT_SECRET: testSecret,
        DATABASE_URL: 'postgresql://localhost/test',
      }).success,
    ).toBe(true);
  });
  it('rejects unsafe seed configuration before database changes', () => {
    expect(seedSchema.safeParse({}).success).toBe(false);
    expect(
      seedSchema.safeParse({
        DEMO_RESEARCHER_PASSWORD: password,
        DEMO_OBSERVER_PASSWORD: password,
        DEMO_RESEARCHER_EMAIL: 'same@test.local',
        DEMO_OBSERVER_EMAIL: 'SAME@test.local',
      }).success,
    ).toBe(false);
  });
});

describe('Login', () => {
  it.each(['RESEARCHER', 'OBSERVER'] as const)(
    'logs in a %s and returns only public user fields',
    async (role) => {
      lookup.mockResolvedValueOnce({ ...user, role });
      const response = await request(app)
        .post('/auth/login')
        .send({ email: 'RESEARCHER@test.local', password });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.data).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: user.id, email: user.email, role },
      });
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
      expect(response.body.data.user).not.toHaveProperty('password');
      const find = vi
        .spyOn(database.mission, 'findMany')
        .mockResolvedValueOnce([]);
      expect(
        (
          await request(app)
            .get('/missions')
            .auth(response.body.data.accessToken, { type: 'bearer' })
        ).status,
      ).toBe(200);
      find.mockRestore();
    },
  );
  it('uses the same error for an unknown email and wrong password', async () => {
    lookup.mockResolvedValueOnce(null);
    const unknown = await request(app)
      .post('/auth/login')
      .send({ email: 'unknown@test.local', password });
    const wrong = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'wrong' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });
  it.each([
    {},
    { email: 'invalid', password },
    { email: user.email, password: '' },
    { email: user.email, password: 'x'.repeat(129) },
    { email: user.email, password, role: 'RESEARCHER' },
  ])('rejects malformed login %j', async (body) => {
    expect((await request(app).post('/auth/login').send(body)).status).toBe(
      400,
    );
    expect(lookup).not.toHaveBeenCalled();
  });
  it('limits repeated login attempts', async () => {
    const limitedApp = createApp(database, testSecret);
    for (let count = 0; count < 20; count++) {
      expect(
        (await request(limitedApp).post('/auth/login').send({})).status,
      ).toBe(400);
    }
    const response = await request(limitedApp).post('/auth/login').send({});
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('Authentication and authorization', () => {
  it.each(['get', 'post', 'patch', 'delete'] as const)(
    'requires authentication on mission %s',
    async (method) => {
      const path =
        method === 'get' || method === 'post'
          ? '/missions'
          : `/missions/${testUserId}`;
      const response = await request(app)[method](path).send({ name: 'Demo' });
      expect(response.status).toBe(401);
      expect(lookup).not.toHaveBeenCalled();
    },
  );
  it.each(['Basic abc', 'Bearer garbage', `Bearer ${token} extra`])(
    'rejects invalid authorization %s',
    async (header) => {
      expect(
        (await request(app).get('/missions').set('Authorization', header))
          .status,
      ).toBe(401);
      expect(lookup).not.toHaveBeenCalled();
    },
  );
  it.each([
    'expired',
    'wrong-key',
    'wrong-issuer',
    'wrong-audience',
    'wrong-algorithm',
    'missing-expiry',
    'bad-subject',
    'future',
  ])('rejects a %s token', async (kind) => {
    let jwt = new SignJWT({})
      .setProtectedHeader({
        alg: kind === 'wrong-algorithm' ? 'HS384' : 'HS256',
      })
      .setSubject(kind === 'bad-subject' ? 'invalid' : testUserId)
      .setIssuer(kind === 'wrong-issuer' ? 'other' : 'aerqyn-api')
      .setAudience(kind === 'wrong-audience' ? 'other' : 'aerqyn')
      .setIssuedAt()
      .setExpirationTime(kind === 'expired' ? '-1s' : '15m');
    if (kind === 'missing-expiry')
      jwt = new SignJWT({
        sub: testUserId,
        iss: 'aerqyn-api',
        aud: 'aerqyn',
        iat: Math.floor(Date.now() / 1000),
      }).setProtectedHeader({ alg: 'HS256' });
    if (kind === 'future') jwt = jwt.setNotBefore('1h');
    const signed = await jwt.sign(
      new TextEncoder().encode(
        kind === 'wrong-key'
          ? 'different-secret-01234567890123456789'
          : testSecret,
      ),
    );
    expect(
      (await request(app).get('/missions').auth(signed, { type: 'bearer' }))
        .status,
    ).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('rejects a deleted user', async () => {
    lookup.mockResolvedValueOnce(null);
    expect(
      (await request(app).get('/missions').auth(token, { type: 'bearer' }))
        .status,
    ).toBe(401);
  });
  it('does not trust a role supplied inside a token', async () => {
    lookup.mockResolvedValueOnce({ ...user, role: 'OBSERVER' });
    const forgedRole = await new SignJWT({ role: 'RESEARCHER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(testUserId)
      .setIssuer('aerqyn-api')
      .setAudience('aerqyn')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(testSecret));
    expect(
      (
        await request(app)
          .post('/missions')
          .auth(forgedRole, { type: 'bearer' })
          .send({ name: 'Forbidden' })
      ).status,
    ).toBe(403);
  });
  it.each(['post', 'patch', 'delete'] as const)(
    'blocks Observer %s before mission queries',
    async (method) => {
      lookup.mockResolvedValueOnce({ ...user, role: 'OBSERVER' });
      const create = vi.spyOn(database.mission, 'create');
      const update = vi.spyOn(database.mission, 'update');
      const remove = vi.spyOn(database.mission, 'delete');
      const path = method === 'post' ? '/missions' : `/missions/${testUserId}`;
      const client = request(app);
      const response = await client[method](path)
        .auth(token, { type: 'bearer' })
        .send({ name: 'Forbidden' });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      create.mockRestore();
      update.mockRestore();
      remove.mockRestore();
    },
  );
});
