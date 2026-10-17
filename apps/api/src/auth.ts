import { Router, type RequestHandler } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { PrismaClient, Role } from './generated/prisma/client.js';
import { ApiError } from './errors.js';
import { hashPassword, verifyPassword } from './passwords.js';

export const jwtSecretSchema = z
  .string()
  .min(32)
  .max(1024)
  .refine(
    (value) => value.trim() === value && !value.startsWith('replace_'),
    'Set a randomly generated JWT secret',
  );
export const emailSchema = z.email().max(254).trim().toLowerCase();
export const seedPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (value) => !value.startsWith('replace_'),
    'Choose a local demo password',
  );
const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
const subjectSchema = z.uuid();
const issuer = 'aerqyn-api';
const audience = 'aerqyn';
export const tokenLifetimeSeconds = 900;

export function createAuth(database: PrismaClient, secret: string) {
  const key = new TextEncoder().encode(jwtSecretSchema.parse(secret));
  // Missing accounts still perform a real password check without using a real hash.
  const dummyHash = hashPassword('unused dummy password');
  const router = Router();
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: () => {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many login attempts; try again later',
      );
    },
  });
  router.post('/login', loginLimit, async (request, response) => {
    const input = loginSchema.safeParse(request.body);
    if (!input.success)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Provide a valid email and password (1–128 characters) only',
      );
    const user = await database.user.findUnique({
      where: { email: input.data.email },
    });
    const valid = await verifyPassword(
      input.data.password,
      user?.passwordHash ?? (await dummyHash),
    );
    if (!user || !valid)
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${tokenLifetimeSeconds}s`)
      .sign(key);
    response.set('Cache-Control', 'no-store').json({
      data: {
        accessToken: token,
        tokenType: 'Bearer',
        expiresIn: tokenLifetimeSeconds,
        user: { id: user.id, email: user.email, role: user.role },
      },
    });
  });

  const authenticate: RequestHandler = async (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match)
      throw new ApiError(
        401,
        'UNAUTHORIZED',
        'A valid Bearer token is required',
      );
    let userId: string;
    try {
      const { payload } = await jwtVerify(match[1]!, key, {
        algorithms: ['HS256'],
        issuer,
        audience,
        requiredClaims: ['sub', 'iat', 'exp'],
        maxTokenAge: '15m',
      });
      userId = subjectSchema.parse(payload.sub);
    } catch {
      throw new ApiError(
        401,
        'UNAUTHORIZED',
        'A valid Bearer token is required',
      );
    }
    // Read the current role from PostgreSQL; deleted users and role changes take effect immediately.
    const user = await database.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user)
      throw new ApiError(
        401,
        'UNAUTHORIZED',
        'A valid Bearer token is required',
      );
    response.locals.user = user;
    next();
  };
  return { router, authenticate };
}

export function requireRole(role: Role): RequestHandler {
  return (_request, response, next) => {
    const user = response.locals.user as { id: string; role: Role } | undefined;
    if (!user)
      throw new ApiError(
        401,
        'UNAUTHORIZED',
        'A valid Bearer token is required',
      );
    if (user.role !== role)
      throw new ApiError(403, 'FORBIDDEN', 'Researcher role required');
    next();
  };
}
