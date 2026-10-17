import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import rawRequest from 'supertest';
import { missionClient, testSecret } from './test-client.js';
import { seedDemoUsers } from './seed.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createDatabase } from './database.js';
import { verifyPassword } from './passwords.js';

const seedEnvironment = {
  DEMO_RESEARCHER_PASSWORD: 'integration-researcher-password',
  DEMO_OBSERVER_PASSWORD: 'integration-observer-password',
};

describe.skipIf(process.env.AERQYN_INTEGRATION !== '1')(
  'Authenticated mission CRUD with PostgreSQL',
  () => {
    const schema = `m2_test_${randomUUID().replaceAll('-', '')}`;
    let database: ReturnType<typeof createDatabase>;
    let admin: ReturnType<typeof createDatabase>;
    let app: ReturnType<typeof createApp>;
    let token: string;
    const request = (target: typeof app) => missionClient(target, token);

    beforeAll(async () => {
      if (!process.env.DATABASE_URL)
        throw new Error('DATABASE_URL is required for integration tests');
      const url = new URL(process.env.DATABASE_URL);
      admin = createDatabase(url.href);
      // The identifier contains only a fixed prefix and generated hex characters.
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      url.searchParams.set('schema', schema);
      const migration = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              '../../../node_modules/prisma/build/index.js',
              import.meta.url,
            ),
          ),
          'migrate',
          'deploy',
        ],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: { ...process.env, DATABASE_URL: url.href },
          timeout: 60000,
          windowsHide: true,
          encoding: 'utf8',
        },
      );
      if (migration.status !== 0)
        throw new Error(
          'Test schema migration failed; run db:migrate to diagnose',
        );
      database = createDatabase(url.href);
      app = createApp(database, testSecret);
      await seedDemoUsers(database, seedEnvironment);
      const login = await rawRequest(app).post('/auth/login').send({
        email: 'researcher@aerqyn.local',
        password: seedEnvironment.DEMO_RESEARCHER_PASSWORD,
      });
      expect(login.status).toBe(200);
      token = login.body.data.accessToken;
    }, 75000);

    afterAll(async () => {
      await database?.$disconnect();
      if (admin) {
        try {
          await admin.$executeRawUnsafe(
            `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
          );
        } finally {
          await admin.$disconnect();
        }
      }
    });

    it('reseeds without duplicates and persists salted password hashes', async () => {
      const before = await database.user.findMany({
        orderBy: { email: 'asc' },
      });
      await seedDemoUsers(database, seedEnvironment);
      const after = await database.user.findMany({ orderBy: { email: 'asc' } });
      expect(after).toHaveLength(2);
      expect(after.map((user) => user.id)).toEqual(
        before.map((user) => user.id),
      );
      for (const user of after) {
        const password =
          user.role === 'RESEARCHER'
            ? seedEnvironment.DEMO_RESEARCHER_PASSWORD
            : seedEnvironment.DEMO_OBSERVER_PASSWORD;
        expect(user.passwordHash).not.toBe(password);
        expect(await verifyPassword(password, user.passwordHash)).toBe(true);
      }
    });

    it('allows Observer reads, blocks writes, and applies role changes to an existing token', async () => {
      const login = await rawRequest(app).post('/auth/login').send({
        email: 'observer@aerqyn.local',
        password: seedEnvironment.DEMO_OBSERVER_PASSWORD,
      });
      expect(login.status).toBe(200);
      const observer = missionClient(app, login.body.data.accessToken);
      const created = await request(app)
        .post('/missions')
        .send({ name: 'RBAC check' });
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      expect((await observer.get('/missions')).status).toBe(200);
      expect((await observer.get(`/missions/${id}`)).status).toBe(200);
      expect(
        (await observer.post('/missions').send({ name: 'Forbidden' })).status,
      ).toBe(403);
      expect(
        (await observer.patch(`/missions/${id}`).send({ name: 'Forbidden' }))
          .status,
      ).toBe(403);
      expect((await observer.delete(`/missions/${id}`)).status).toBe(403);
      expect(await database.mission.count()).toBe(1);
      expect(
        (await database.mission.findUniqueOrThrow({ where: { id } })).name,
      ).toBe('RBAC check');
      const researcher = await database.user.findUniqueOrThrow({
        where: { email: 'researcher@aerqyn.local' },
      });
      try {
        await database.user.update({
          where: { id: researcher.id },
          data: { role: 'OBSERVER' },
        });
        expect((await request(app).delete(`/missions/${id}`)).status).toBe(403);
      } finally {
        await database.user.update({
          where: { id: researcher.id },
          data: { role: 'RESEARCHER' },
        });
        await database.mission.delete({ where: { id } });
      }
    });

    it('creates, lists, reads, updates, persists and deletes a mission', async () => {
      const created = await request(app)
        .post('/missions')
        .send({ name: '  Test route  ' });
      expect(created.status).toBe(201);
      const mission = created.body.data;
      expect(created.headers.location).toBe(`/missions/${mission.id}`);
      expect(mission).toMatchObject({
        name: 'Test route',
        description: '',
        status: 'DRAFT',
        settings: { durationSeconds: 300, telemetryIntervalMs: 1000 },
      });
      expect(Number.isNaN(Date.parse(mission.createdAt))).toBe(false);
      const listed = await request(app).get('/missions?limit=1&offset=0');
      expect(listed.status).toBe(200);
      expect(listed.body.data).toEqual([mission]);
      expect((await request(app).get('/missions?offset=1')).body.data).toEqual(
        [],
      );
      const read = await request(app).get(`/missions/${mission.id}`);
      expect(read.status).toBe(200);
      expect(read.body.data).toEqual(mission);
      const updated = await request(app)
        .patch(`/missions/${mission.id}`)
        .send({
          name: 'Updated',
          description: 'Local synthetic mission',
          settings: { durationSeconds: 120, telemetryIntervalMs: 500 },
        });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({
        name: 'Updated',
        status: 'DRAFT',
        createdAt: mission.createdAt,
      });
      const nameOnly = await request(app)
        .patch(`/missions/${mission.id}`)
        .send({ name: 'Renamed' });
      expect(nameOnly.status).toBe(200);
      expect(nameOnly.body.data.description).toBe('Local synthetic mission');
      expect(nameOnly.body.data.settings).toEqual({
        durationSeconds: 120,
        telemetryIntervalMs: 500,
      });
      const secondUrl = new URL(process.env.DATABASE_URL!);
      secondUrl.searchParams.set('schema', schema);
      const secondConnection = createDatabase(secondUrl.href);
      try {
        // A new client proves this record is persisted beyond an Express app instance.
        const separateApp = createApp(secondConnection, testSecret);
        expect(
          (await request(separateApp).get(`/missions/${mission.id}`)).body.data
            .name,
        ).toBe('Renamed');
      } finally {
        await secondConnection.$disconnect();
      }
      expect(
        (await request(app).delete(`/missions/${mission.id}`)).status,
      ).toBe(204);
      expect((await request(app).get(`/missions/${mission.id}`)).status).toBe(
        404,
      );
      expect(
        (
          await request(app)
            .patch(`/missions/${mission.id}`)
            .send({ name: 'Missing' })
        ).status,
      ).toBe(404);
      expect(
        (await request(app).delete(`/missions/${mission.id}`)).status,
      ).toBe(404);
      expect((await request(app).get('/missions')).body.data).toEqual([]);
    });
  },
);
