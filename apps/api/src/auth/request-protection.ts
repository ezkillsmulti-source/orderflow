import { Injectable, ForbiddenException, HttpException } from '@nestjs/common';
import { csrfSync } from 'csrf-sync';
import type { RequestHandler, Request, Response } from 'express';
import { SessionRuntime } from './session.runtime.js';
import { LoginThrottle } from './login-throttle.js';
import { isHealthRequest } from './http-path.js';

@Injectable()
export class RequestProtection {
  readonly csrf = csrfSync({
    size: 32,
    getTokenFromRequest: (req) => {
      const token = req.headers['x-csrf-token'];
      return typeof token === 'string' && token.length <= 256
        ? token
        : undefined;
    },
  });
  readonly middleware: RequestHandler;
  constructor(sessions: SessionRuntime, throttle: LoginThrottle) {
    this.middleware = (req, res, next) => {
      if (isHealthRequest(req)) {
        next();
        return;
      }
      void this.check(req, res, sessions, throttle)
        .then(() => next())
        .catch((error) => {
          const status =
            error instanceof HttpException ? error.getStatus() : 503;
          if (status === 429 && error instanceof HttpException) {
            const body = error.getResponse() as { retryAfter: number };
            res.setHeader('Retry-After', body.retryAfter);
          }
          res.status(status).json({
            statusCode: status,
            message:
              status === 403
                ? 'Request forbidden.'
                : status === 429
                  ? 'Too many requests.'
                  : 'Authentication storage unavailable.',
          });
        });
    };
  }
  private async check(
    req: Request,
    res: Response,
    sessions: SessionRuntime,
    throttle: LoginThrottle,
  ): Promise<void> {
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const origin = req.headers.origin;
    if (
      (!safe && !origin) ||
      (origin && !sessions.configuration.origins.includes(origin))
    ) {
      throw new ForbiddenException();
    }
    // A global shared budget bounds allocation of sessions and per-identifier buckets.
    await throttle.admit();
    if (!safe) {
      await new Promise<void>((resolve, reject) =>
        this.csrf.csrfSynchronisedProtection(req, res, (error) =>
          error ? reject(new ForbiddenException()) : resolve(),
        ),
      );
    }
  }
}
