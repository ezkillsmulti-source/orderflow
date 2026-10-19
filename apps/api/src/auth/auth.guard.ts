import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { SessionRuntime } from './session.runtime.js';
import { PUBLIC_ROUTE } from './public.js';
import './identity.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
    private readonly sessions: SessionRuntime,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!req.session?.userId) throw new UnauthorizedException();
    const user = await this.database.client.user
      .findUnique({
        where: { id: req.session.userId },
        select: { id: true, email: true, role: true, active: true },
      })
      .catch(() => {
        throw new ServiceUnavailableException(
          'Authentication storage unavailable.',
        );
      });
    if (!user?.active || !(await this.sessions.touch(req))) {
      await this.sessions.destroy(req, res);
      throw new UnauthorizedException();
    }
    req.authenticatedUser = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
