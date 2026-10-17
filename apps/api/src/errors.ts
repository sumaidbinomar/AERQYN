import type { ErrorRequestHandler } from 'express';
import { Prisma } from './generated/prisma/client.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ApiError) {
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Mission not found' } });
    return;
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
      });
      return;
    }
    if (error.type === 'entity.too.large') {
      response.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds 16 KB',
        },
      });
      return;
    }
  }
  // Avoid logging database errors, which may contain connection details or input.
  console.error('Unhandled API request error');
  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
};
