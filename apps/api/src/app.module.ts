import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { ProductsModule } from './products/products.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({ imports: [ConfigModule, HealthModule, AuthModule, ProductsModule] })
export class AppModule {}
