import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client.js';
import { ApiError } from './errors.js';

const settingsSchema = z.strictObject({
  durationSeconds: z.number().int().min(10).max(3600).default(300),
  telemetryIntervalMs: z.number().int().min(100).max(5000).default(1000),
});
const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(''),
  settings: settingsSchema.prefault({}),
});
const updateSchema = z
  .strictObject({
    name: createSchema.shape.name.optional(),
    description: createSchema.shape.description.removeDefault().optional(),
    settings: settingsSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one field',
  );
const idSchema = z.uuid();
const listSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  }
  return result.data;
}

export function missionRoutes(database: PrismaClient) {
  const router = Router();
  router.post('/', async (request, response) => {
    const data = parse(createSchema, request.body);
    const mission = await database.mission.create({ data });
    response
      .location(`/missions/${mission.id}`)
      .status(201)
      .json({ data: mission });
  });
  router.get('/', async (request, response) => {
    const { limit, offset } = parse(listSchema, request.query);
    const missions = await database.mission.findMany({
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    response.json({ data: missions, pagination: { limit, offset } });
  });
  router.get('/:id', async (request, response) => {
    const id = parse(idSchema, request.params.id);
    const mission = await database.mission.findUnique({ where: { id } });
    if (!mission) throw new ApiError(404, 'NOT_FOUND', 'Mission not found');
    response.json({ data: mission });
  });
  router.patch('/:id', async (request, response) => {
    const id = parse(idSchema, request.params.id);
    const data = parse(updateSchema, request.body);
    const mission = await database.mission.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.settings !== undefined ? { settings: data.settings } : {}),
      },
    });
    response.json({ data: mission });
  });
  router.delete('/:id', async (request, response) => {
    const id = parse(idSchema, request.params.id);
    await database.mission.delete({ where: { id } });
    response.status(204).end();
  });
  return router;
}
