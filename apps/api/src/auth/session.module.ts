import {
  Module,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigModule } from '../config/config.module.js';
import {
  AUTH_CONFIGURATION,
  readAuthConfiguration,
} from './auth.configuration.js';
import { SessionRuntime } from './session.runtime.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AUTH_CONFIGURATION,
      useFactory: () => readAuthConfiguration(process.env),
    },
    SessionRuntime,
  ],
  exports: [SessionRuntime, AUTH_CONFIGURATION],
})
export class SessionModule implements NestModule {
  constructor(
    private readonly runtime: SessionRuntime,
    private readonly adapter: HttpAdapterHost,
  ) {}
  configure(consumer: MiddlewareConsumer): void {
    this.adapter.httpAdapter
      .getInstance()
      .set('trust proxy', this.runtime.configuration.trustProxy);
    consumer.apply(this.runtime.middleware).forRoutes('{*path}');
  }
}
