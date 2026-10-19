import { Module } from '@nestjs/common';
import { readEnvironment } from './environment.js';

export const ENVIRONMENT = Symbol('ENVIRONMENT');

@Module({
  providers: [
    { provide: ENVIRONMENT, useFactory: () => readEnvironment(process.env) },
  ],
  exports: [ENVIRONMENT],
})
export class ConfigModule {}
