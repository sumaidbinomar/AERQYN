import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client.js';
import { emailSchema, seedPasswordSchema } from './auth.js';
import { hashPassword } from './passwords.js';

export const seedSchema = z
  .object({
    DEMO_RESEARCHER_EMAIL: emailSchema.default('researcher@aerqyn.local'),
    DEMO_RESEARCHER_PASSWORD: seedPasswordSchema,
    DEMO_OBSERVER_EMAIL: emailSchema.default('observer@aerqyn.local'),
    DEMO_OBSERVER_PASSWORD: seedPasswordSchema,
  })
  .refine(
    (value) => value.DEMO_RESEARCHER_EMAIL !== value.DEMO_OBSERVER_EMAIL,
    'Demo emails must differ',
  );

export async function seedDemoUsers(
  database: PrismaClient,
  environment: unknown,
) {
  const config = seedSchema.parse(environment);
  const accounts = [
    {
      email: config.DEMO_RESEARCHER_EMAIL,
      password: config.DEMO_RESEARCHER_PASSWORD,
      role: 'RESEARCHER' as const,
    },
    {
      email: config.DEMO_OBSERVER_EMAIL,
      password: config.DEMO_OBSERVER_PASSWORD,
      role: 'OBSERVER' as const,
    },
  ];
  const users = await Promise.all(
    accounts.map(async ({ email, password, role }) => ({
      email,
      role,
      passwordHash: await hashPassword(password),
    })),
  );
  // Explicit reseeding updates demo credentials/roles, retaining each account's ID.
  await database.$transaction(
    users.map((user) =>
      database.user.upsert({
        where: { email: user.email },
        create: user,
        update: user,
      }),
    ),
  );
}
