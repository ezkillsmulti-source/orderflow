import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { SessionModule } from './auth/session.module.js';

@Module({ imports: [ConfigModule, HealthModule, SessionModule] })
export class AppModule {}
