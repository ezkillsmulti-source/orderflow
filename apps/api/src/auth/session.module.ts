import { Module } from '@nestjs/common';
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
export class SessionModule {}
