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
import { createServer } from 'node:http';
import { once } from 'node:events';
import { io as connectSocket, type Socket } from 'socket.io-client';
import pg from 'pg';
import {
  connectRedis,
  simulate,
  settingsSchema,
  stateKey,
  telemetryChannel,
  viewersKey,
  type Telemetry,
} from '@aerqyn/simulation';
import { createRealtime } from './realtime.js';
import { tick } from '../../worker/src/simulator.js';
import { vi } from 'vitest';
import { SignJWT } from 'jose';
import { connect as connectRabbit } from 'amqplib';
import {
  analyzeJob,
  createAnomalyPipeline,
} from '../../worker/src/anomalies.js';
import { alertChannel, type Alert } from '@aerqyn/simulation/anomalies';

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

    it('queues synthetic anomalies, detects once, persists and broadcasts only to authorized mission viewers', async () => {
      if (!process.env.RABBITMQ_URL)
        throw new Error('RABBITMQ_URL is required');
      const redis = connectRedis(
        process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      );
      const subscriber = connectRedis(
        process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      );
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
      });
      const queue = `aerqyn.test.${randomUUID()}`;
      const record = vi.fn(async () => {});
      let pipeline = createAnomalyPipeline(
        pool,
        redis,
        process.env.RABBITMQ_URL,
        queue,
        record,
      );
      const broker = await connectRabbit(process.env.RABBITMQ_URL);
      const brokerChannel = await broker.createConfirmChannel();
      const server = createServer(createApp(database, testSecret, redis));
      const realtime = createRealtime(
        server,
        database,
        testSecret,
        redis,
        subscriber,
      );
      const ids: string[] = [];
      const sockets: Socket[] = [];
      try {
        await Promise.all([redis.connect(), subscriber.connect()]);
        await realtime.start();
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Missing port');
        const login = await rawRequest(app).post('/auth/login').send({
          email: 'observer@aerqyn.local',
          password: seedEnvironment.DEMO_OBSERVER_PASSWORD,
        });
        const observer = missionClient(app, login.body.data.accessToken);
        for (let index = 0; index < 2; index++) {
          const created = await request(app)
            .post('/missions')
            .send({ name: `Anomaly ${index}` });
          ids.push(created.body.data.id);
        }
        const [id, otherId] = ids as [string, string];
        const command = { droneId: 'drone-1', type: 'GPS_JUMP' };
        expect(
          (await request(app).post(`/missions/${id}/anomalies`).send(command))
            .status,
        ).toBe(409);
        expect(
          (
            await request(app)
              .post(`/missions/${randomUUID()}/anomalies`)
              .send(command)
          ).status,
        ).toBe(404);
        expect((await request(app).post(`/missions/${id}/start`)).status).toBe(
          200,
        );
        const received: Alert[][] = [[], [], []];
        const frames: Telemetry[] = [];
        for (const [index, accessToken] of [
          token,
          login.body.data.accessToken,
          token,
        ].entries()) {
          const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
            auth: { token: accessToken },
            transports: ['websocket'],
            reconnection: false,
          });
          sockets.push(socket);
          await new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
          });
          socket.on('alert', (event: Alert) => received[index]!.push(event));
          socket.on('telemetry', (event: Telemetry) => {
            if (index === 0) frames.push(event);
          });
          expect(
            await socket.timeout(3000).emitWithAck('mission:join', {
              missionId: index === 2 ? otherId : id,
            }),
          ).toHaveProperty('data');
        }
        const jobs: string[] = [];
        for (const type of ['GPS_JUMP', 'BATTERY_DROP', 'COMMUNICATION_LOSS']) {
          const result = await request(app)
            .post(`/missions/${id}/anomalies`)
            .send({ ...command, type });
          expect(result.status).toBe(202);
          jobs.push(result.body.data.id);
        }
        // Acceptance is durable before any broker connection or publication.
        expect(
          await database.anomalyJob.count({
            where: { missionId: id, processedAt: null },
          }),
        ).toBe(3);
        const unavailable = createAnomalyPipeline(
          pool,
          redis,
          'amqp://unused:unused@127.0.0.1:1',
          queue,
        );
        await expect(unavailable.pump()).rejects.toThrow();
        await unavailable.close();
        expect(
          await database.anomalyJob.count({
            where: { missionId: id, processedAt: null },
          }),
        ).toBe(3);
        await pipeline.pump();
        await vi.waitFor(
          async () =>
            expect(
              await database.alert.count({ where: { missionId: id } }),
            ).toBe(3),
          { timeout: 5000 },
        );
        // Simulate worker restart between durable processing and notification.
        await pipeline.close();
        pipeline = createAnomalyPipeline(
          pool,
          redis,
          process.env.RABBITMQ_URL,
          queue,
          record,
        );
        record.mockRejectedValueOnce(
          new Error('Journal temporarily unavailable'),
        );
        await expect(pipeline.pump()).rejects.toThrow(
          'Journal temporarily unavailable',
        );
        expect(
          await database.anomalyJob.count({
            where: { missionId: id, notifiedAt: null },
          }),
        ).toBe(3);
        expect(await database.alert.count({ where: { missionId: id } })).toBe(
          3,
        );
        record.mockClear();
        await pipeline.pump();
        await vi.waitFor(
          () => {
            expect(received[0]).toHaveLength(3);
            expect(received[1]).toHaveLength(3);
            // Alerts and telemetry use separate Redis subscriptions; wait for both.
            expect(frames).toHaveLength(3);
          },
          { timeout: 5000 },
        );
        expect(received[2]).toHaveLength(0);
        expect(record.mock.calls).toHaveLength(6);
        expect(frames).toHaveLength(3);
        expect(
          frames.some(
            (frame) => frame.drones[0]!.connectionStatus === 'DISCONNECTED',
          ),
        ).toBe(true);
        expect(frames.some((frame) => frame.drones[0]!.x > 100)).toBe(true);
        expect(frames.some((frame) => frame.drones[0]!.battery < 70)).toBe(
          true,
        );
        expect(new Set(received[0]!.map((alert) => alert.type)).size).toBe(3);
        await Promise.all([
          analyzeJob(pool, jobs[0]!),
          analyzeJob(pool, jobs[0]!),
        ]);
        brokerChannel.sendToQueue(
          queue,
          Buffer.from(JSON.stringify({ jobId: jobs[0] })),
          { persistent: true },
        );
        brokerChannel.sendToQueue(queue, Buffer.from('invalid-json'), {
          persistent: true,
        });
        await brokerChannel.waitForConfirms();
        await vi.waitFor(
          async () =>
            expect(
              (await brokerChannel.checkQueue(`${queue}.dead`)).messageCount,
            ).toBe(1),
          { timeout: 5000 },
        );
        expect(await database.alert.count({ where: { missionId: id } })).toBe(
          3,
        );
        const history = await observer.get(`/missions/${id}/alerts?limit=2`);
        expect(history.status).toBe(200);
        expect(history.body.data).toHaveLength(2);
        expect(history.body.data[0]).not.toHaveProperty('jobId');
        expect(
          (await observer.get(`/missions/${id}/alerts?offset=2`)).body.data,
        ).toHaveLength(1);
        expect(
          (await observer.get(`/missions/${otherId}/alerts`)).body.data,
        ).toEqual([]);
        // Pending old-run commands cannot affect a restarted mission.
        const stale = await request(app)
          .post(`/missions/${id}/anomalies`)
          .send(command);
        await request(app).post(`/missions/${id}/stop`);
        await request(app).post(`/missions/${id}/start`);
        await analyzeJob(pool, stale.body.data.id);
        expect(
          (
            await database.anomalyJob.findUniqueOrThrow({
              where: { id: stale.body.data.id },
            })
          ).outcome,
        ).toBe('STALE');
        // Stale alert publications are ignored by the API too.
        await redis.publish(alertChannel, JSON.stringify(received[0]![0]));
        await pipeline.pump();
        // A malformed stored payload terminates rather than poisoning the retry loop.
        const mission = await database.mission.findUniqueOrThrow({
          where: { id },
        });
        const invalid = await database.anomalyJob.create({
          data: { missionId: id, startedAt: mission.startedAt!, payload: {} },
        });
        await analyzeJob(pool, invalid.id);
        expect(
          (
            await database.anomalyJob.findUniqueOrThrow({
              where: { id: invalid.id },
            })
          ).outcome,
        ).toBe('INVALID');
        expect(await database.alert.count({ where: { missionId: id } })).toBe(
          3,
        );
        await vi.waitFor(
          async () =>
            expect((await brokerChannel.checkQueue(queue)).messageCount).toBe(
              0,
            ),
          { timeout: 5000 },
        );
        expect(received[0]).toHaveLength(3);
      } finally {
        sockets.forEach((socket) => socket.disconnect());
        await pipeline.close();
        await realtime.close();
        await brokerChannel.deleteQueue(queue);
        await brokerChannel.deleteQueue(`${queue}.dead`);
        await broker.close();
        await pool.end();
        for (const id of ids) {
          await redis.del([stateKey(id), viewersKey(id)]);
          await database.mission.deleteMany({ where: { id } });
        }
        redis.destroy();
        subscriber.destroy();
      }
    }, 30000);

    it('streams worker telemetry to authenticated mission rooms, caches state, and tracks viewers', async () => {
      const redis = connectRedis(
        process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      );
      const subscriber = connectRedis(
        process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      );
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
      });
      const server = createServer(createApp(database, testSecret, redis));
      const realtime = createRealtime(
        server,
        database,
        testSecret,
        redis,
        subscriber,
      );
      const sockets: Socket[] = [];
      const ids: string[] = [];
      try {
        await Promise.all([redis.connect(), subscriber.connect()]);
        await realtime.start();
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Missing test port');
        const url = `http://127.0.0.1:${address.port}`;
        async function socketFor(accessToken: string) {
          const socket = connectSocket(url, {
            auth: { token: accessToken },
            transports: ['websocket'],
            reconnection: false,
          });
          sockets.push(socket);
          await new Promise<void>((resolve, reject) => {
            socket.once('connect', resolve);
            socket.once('connect_error', reject);
          });
          return socket;
        }
        const rejected = connectSocket(url, {
          auth: { token: 'invalid' },
          reconnection: false,
        });
        sockets.push(rejected);
        expect(
          (
            await new Promise<Error>((resolve) =>
              rejected.once('connect_error', resolve),
            )
          ).message,
        ).toBe('UNAUTHORIZED');
        const login = await rawRequest(app).post('/auth/login').send({
          email: 'observer@aerqyn.local',
          password: seedEnvironment.DEMO_OBSERVER_PASSWORD,
        });
        const observer = missionClient(
          createApp(database, testSecret, redis),
          login.body.data.accessToken,
        );
        for (let index = 0; index < 2; index++) {
          const created = await request(app)
            .post('/missions')
            .send({
              name: `Stream ${index}`,
              settings: { durationSeconds: 10, telemetryIntervalMs: 100 },
            });
          ids.push(created.body.data.id);
        }
        const [id, otherId] = ids as [string, string];
        expect((await observer.post(`/missions/${id}/start`)).status).toBe(403);
        const starts = await Promise.all([
          request(app).post(`/missions/${id}/start`),
          request(app).post(`/missions/${id}/start`),
        ]);
        expect(starts.map((response) => response.status).sort()).toEqual([
          200, 409,
        ]);
        const start = new Date(
          (await database.mission.findUniqueOrThrow({ where: { id } }))
            .startedAt!,
        );
        expect(
          (
            await request(app)
              .patch(`/missions/${id}`)
              .send({ name: 'blocked' })
          ).status,
        ).toBe(409);
        expect((await request(app).delete(`/missions/${id}`)).status).toBe(409);
        const a = await socketFor(token);
        const b = await socketFor(login.body.data.accessToken);
        const c = await socketFor(token);
        const events: Telemetry[][] = [[], [], []];
        [a, b, c].forEach((socket, index) =>
          socket.on('telemetry', (value: Telemetry) =>
            events[index]!.push(value),
          ),
        );
        expect(
          await a
            .timeout(3000)
            .emitWithAck('mission:join', { missionId: 'bad' }),
        ).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
        expect(
          await a
            .timeout(3000)
            .emitWithAck('mission:join', { missionId: randomUUID() }),
        ).toMatchObject({ error: { code: 'NOT_FOUND' } });
        for (const socket of [a, b])
          expect(
            await socket
              .timeout(3000)
              .emitWithAck('mission:join', { missionId: id }),
          ).toMatchObject({ data: { missionId: id } });
        await c
          .timeout(3000)
          .emitWithAck('mission:join', { missionId: otherId });
        expect(
          (await observer.get(`/missions/${id}/viewers`)).body.data.count,
        ).toBe(2);
        const record = vi.fn(async () => {});
        await tick(pool, redis, new Date(+start + 250), record);
        await vi.waitFor(() => {
          expect(events[0]).toHaveLength(1);
          expect(events[1]).toHaveLength(1);
        });
        expect(events[2]).toHaveLength(0);
        expect(events[0]![0]).toMatchObject({
          missionId: id,
          elapsedMs: 200,
          status: 'RUNNING',
        });
        expect(events[0]![0]!.drones).toHaveLength(3);
        expect(
          (await observer.get(`/missions/${id}/telemetry`)).body.data,
        ).toEqual(events[0]![0]);
        await tick(pool, redis, new Date(+start + 250), record);
        await tick(pool, redis, new Date(+start + 350), record);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
          type: 'telemetry.snapshot',
          data: events[0]![0],
        });
        await vi.waitFor(() => expect(events[0]).toHaveLength(2));
        expect(events[0]![1]!.elapsedMs).toBe(300);
        // Repeated ticks in the same sampling bucket do not duplicate recordings.
        const recorded = await observer.get(`/missions/${id}/replay`);
        expect(recorded.status).toBe(200);
        expect(recorded.body.data.runs).toEqual([start.toISOString()]);
        expect(recorded.body.data.frames).toEqual([events[0]![0]]);

        await b
          .timeout(3000)
          .emitWithAck('mission:join', { missionId: otherId });
        expect(
          (await observer.get(`/missions/${id}/viewers`)).body.data.count,
        ).toBe(1);
        await c.timeout(3000).emitWithAck('mission:leave');
        expect(
          (await observer.get(`/missions/${otherId}/viewers`)).body.data.count,
        ).toBe(1);
        b.disconnect();
        await vi.waitFor(async () =>
          expect(
            (await observer.get(`/missions/${otherId}/viewers`)).body.data
              .count,
          ).toBe(0),
        );
        await redis.zAdd(viewersKey(id), {
          score: Date.now() - 1,
          value: 'expired-socket',
        });
        expect(
          (await observer.get(`/missions/${id}/viewers`)).body.data.count,
        ).toBe(1);
        expect((await request(app).post(`/missions/${id}/stop`)).status).toBe(
          200,
        );
        expect(
          (await observer.get(`/missions/${id}/telemetry`)).body.data,
        ).toBeNull();
        await tick(pool, redis, new Date(+start + 500));
        expect((await request(app).post(`/missions/${id}/stop`)).status).toBe(
          409,
        );
        const restarted = await request(app).post(`/missions/${id}/start`);
        expect(restarted.status).toBe(200);
        expect(
          (await observer.get(`/missions/${id}/telemetry`)).body.data,
        ).toBeNull();
        const nextStart = new Date(restarted.body.data.startedAt);
        const stale = simulate(
          id,
          start,
          settingsSchema.parse({}),
          new Date(+start + 500),
        );
        await redis.publish(telemetryChannel, JSON.stringify(stale));
        await tick(pool, redis, new Date(+nextStart + 10000));
        await vi.waitFor(() => expect(events[0]).toHaveLength(3));
        expect(events[0]![2]!.status).toBe('COMPLETED');
        const latestRun = await observer.get(`/missions/${id}/replay`);
        expect(latestRun.body.data.runs).toEqual([
          nextStart.toISOString(),
          start.toISOString(),
        ]);
        expect(latestRun.body.data.frames).toEqual([events[0]![2]]);
        const previousRun = await observer.get(
          `/missions/${id}/replay?startedAt=${encodeURIComponent(start.toISOString())}`,
        );
        expect(previousRun.body.data.frames).toEqual([events[0]![0]]);
        const missingRun = await observer.get(
          `/missions/${id}/replay?startedAt=2020-01-01T00:00:00.000Z`,
        );
        expect(missingRun.body.data.frames).toEqual([]);

        expect(
          (await database.mission.findUniqueOrThrow({ where: { id } })).status,
        ).toBe('COMPLETED');
        expect(
          (await observer.get(`/missions/${id}/telemetry`)).body.data.status,
        ).toBe('COMPLETED');
        const temporary = await database.user.create({
          data: {
            email: `socket-${randomUUID()}@test.local`,
            passwordHash: 'unused',
            role: 'OBSERVER',
          },
        });
        try {
          const signed = await new SignJWT({})
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(temporary.id)
            .setIssuer('aerqyn-api')
            .setAudience('aerqyn')
            .setIssuedAt()
            .setExpirationTime('15m')
            .sign(new TextEncoder().encode(testSecret));
          const revoked = await socketFor(signed);
          await revoked
            .timeout(3000)
            .emitWithAck('mission:join', { missionId: id });
          let received = false;
          revoked.on('telemetry', () => {
            received = true;
          });
          const disconnected = new Promise<void>((resolve) =>
            revoked.once('disconnect', () => resolve()),
          );
          await database.user.delete({ where: { id: temporary.id } });
          await redis.publish(
            telemetryChannel,
            (await redis.get(stateKey(id)))!,
          );
          await disconnected;
          expect(received).toBe(false);
        } finally {
          await database.user.deleteMany({ where: { id: temporary.id } });
        }
      } finally {
        sockets.forEach((socket) => socket.disconnect());
        await realtime.close();
        await pool.end();
        for (const id of ids) {
          await redis.del([stateKey(id), viewersKey(id)]);
          await database.mission.deleteMany({ where: { id } });
        }
        redis.destroy();
        subscriber.destroy();
      }
    }, 30000);
  },
);
