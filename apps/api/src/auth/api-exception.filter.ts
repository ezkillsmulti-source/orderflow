import {
  Catch,
  HttpException,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isHealthRequest } from './http-path.js';

/** Fixed responses also prevent JSON parser and driver errors from echoing credentials. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (isHealthRequest(req) && error instanceof HttpException) {
      res.status(status).json(error.getResponse());
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const messages: Record<number, string> = {
      400: 'Invalid request.',
      401: 'Unauthenticated.',
      403: 'Request forbidden.',
      404: 'Not found.',
      413: 'Request body too large.',
      429: 'Too many requests.',
      500: 'Internal server error.',
      503: 'Authentication storage unavailable.',
    };
    if (status === 429 && error instanceof HttpException) {
      const body = error.getResponse() as { retryAfter?: number };
      if (body.retryAfter) res.setHeader('Retry-After', body.retryAfter);
    }
    const message =
      status === 401 &&
      error instanceof HttpException &&
      error.message === 'Invalid email or password.'
        ? 'Invalid email or password.'
        : (messages[status] ?? 'Request failed.');
    res.status(status).json({ statusCode: status, message });
  }
}
