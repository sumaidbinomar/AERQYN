import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  telemetryChannel,
  telemetrySchema,
  viewersKey,
  viewerCount,
  type Redis,
} from '@aerqyn/simulation';
import type { PrismaClient } from './generated/prisma/client.js';
import { createAuth } from './auth.js';
import { ApiError } from './errors.js';
import { latestTelemetry } from './simulation.js';

const joinSchema = z.strictObject({ missionId: z.uuid() });
type Reply = (result: unknown) => void;
const room = (id: string) => `mission:${id}`;

export function createRealtime(
  server: HttpServer,
  database: PrismaClient,
  secret: string,
  redis: Redis,
  subscriber: Redis,
) {
  const io = new Server(server, { maxHttpBufferSize: 16 * 1024 });
  const auth = createAuth(database, secret);
  io.use((socket, next) => {
    const token = z
      .string()
      .min(1)
      .max(4096)
      .safeParse(socket.handshake.auth.token);
    if (!token.success) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    auth.verifyToken(token.data).then(
      () => next(),
      () => next(new Error('UNAUTHORIZED')),
    );
  });
  async function broadcastViewers(id: string) {
    io.to(room(id)).emit('mission:viewers', {
      missionId: id,
      count: await viewerCount(redis, id),
    });
  }
  io.on('connection', (socket) => {
    const token = String(socket.handshake.auth.token);
    let mission: string | undefined;
    // Serialize joins/leaves/heartbeats so concurrent messages cannot leak presence.
    let pending = Promise.resolve();
    function enqueue(action: () => Promise<void>) {
      pending = pending.then(action).catch(() => {
        socket.disconnect(true);
      });
    }
    async function leave() {
      const previous = mission;
      mission = undefined;
      if (previous) {
        await socket.leave(room(previous));
        await redis.zRem(viewersKey(previous), socket.id);
        await broadcastViewers(previous);
      }
    }
    async function refresh() {
      await auth.verifyToken(token);
      if (!socket.connected) return;
      if (mission) {
        if (!(await database.mission.findUnique({ where: { id: mission } }))) {
          await leave();
          return;
        }
        await redis
          .multi()
          .zAdd(viewersKey(mission), {
            score: Date.now() + 45000,
            value: socket.id,
          })
          .expire(viewersKey(mission), 60)
          .exec();
        await broadcastViewers(mission);
      }
    }
    const heartbeat = setInterval(() => enqueue(refresh), 15000);
    heartbeat.unref();
    socket.on('mission:join', (input: unknown, reply?: Reply) =>
      enqueue(async () => {
        const ack = typeof reply === 'function' ? reply : () => {};
        try {
          const parsed = joinSchema.safeParse(input);
          if (!parsed.success)
            throw new ApiError(
              400,
              'VALIDATION_ERROR',
              'Provide only a missionId UUID',
            );
          await auth.verifyToken(token);
          const id = parsed.data.missionId;
          const state = await latestTelemetry(database, redis, id);
          await leave();
          if (!socket.connected) return;
          mission = id;
          await socket.join(room(id));
          await refresh();
          ack({ data: { missionId: id, telemetry: state } });
        } catch (error) {
          ack({
            error: {
              code: error instanceof ApiError ? error.code : 'UNAVAILABLE',
              message:
                error instanceof ApiError
                  ? error.message
                  : 'Subscription unavailable',
            },
          });
          if (error instanceof ApiError && error.status === 401)
            socket.disconnect(true);
        }
      }),
    );
    socket.on('mission:leave', (reply?: Reply) =>
      enqueue(async () => {
        await leave();
        if (typeof reply === 'function') reply({ data: { left: true } });
      }),
    );
    socket.on('disconnect', () => {
      clearInterval(heartbeat);
      enqueue(leave);
    });
  });
  async function receive(raw: string) {
    try {
      const state = telemetrySchema.parse(JSON.parse(raw));
      const mission = await database.mission.findUnique({
        where: { id: state.missionId },
      });
      if (
        mission?.startedAt?.toISOString() !== state.startedAt ||
        !['RUNNING', 'COMPLETED'].includes(mission.status)
      )
        return;
      // Re-check tokens and current user existence before every delivery, including expiry.
      for (const socket of io.sockets.sockets.values()) {
        if (!socket.rooms.has(room(state.missionId))) continue;
        try {
          await auth.verifyToken(String(socket.handshake.auth.token));
        } catch {
          socket.disconnect(true);
          continue;
        }
        socket.emit('telemetry', state);
      }
    } catch {
      console.error('Telemetry delivery unavailable');
    }
  }
  return {
    io,
    start: () =>
      subscriber.subscribe(telemetryChannel, (raw) => {
        void receive(raw);
      }),
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      // Presence cleanup runs on the serialized per-socket queues; TTL covers process failure.
    },
  };
}
