import {
  Module,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, HttpAdapterHost } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module.js';
import { SessionModule } from './session.module.js';
import { AuthController } from './auth.controller.js';
import { AuthenticationService } from './authentication.service.js';
import { PasswordService } from './password.service.js';
import { AuthGuard } from './auth.guard.js';
import { RequestProtection } from './request-protection.js';
import { LoginThrottle } from './login-throttle.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { SessionRuntime } from './session.runtime.js';

@Module({
  imports: [DatabaseModule, SessionModule],
  controllers: [AuthController],
  providers: [
    AuthenticationService,
    PasswordService,
    RequestProtection,
    LoginThrottle,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AuthModule implements NestModule {
  constructor(
    private readonly protection: RequestProtection,
    private readonly sessions: SessionRuntime,
    private readonly adapter: HttpAdapterHost,
  ) {}
  configure(consumer: MiddlewareConsumer): void {
    this.adapter.httpAdapter
      .getInstance()
      .set('trust proxy', this.sessions.configuration.trustProxy);
    consumer
      .apply(this.sessions.middleware, this.protection.middleware)
      .forRoutes('{*path}');
  }
}
