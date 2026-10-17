import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(connectionString: string) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema') ?? 'public';
  const adapter = new PrismaPg(
    { connectionString, connectionTimeoutMillis: 5000 },
    { schema },
  );
  return new PrismaClient({ adapter });
}
