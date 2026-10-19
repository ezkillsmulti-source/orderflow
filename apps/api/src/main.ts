import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readEnvironment, type Environment } from './config/environment.js';
import { readAuthConfiguration } from './auth/auth.configuration.js';

async function bootstrap(): Promise<void> {
  // Validate before Nest starts logging; invalid values are never echoed.
  let environment: Environment;
  try {
    environment = readEnvironment(process.env);
    readAuthConfiguration(process.env);
  } catch (error) {
    // readEnvironment throws fixed field descriptions, never input values.
    console.error(`API startup failed: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: false,
    rawBody: true,
  });
  app.enableShutdownHooks();
  await app.listen(environment.port, '127.0.0.1');
}

bootstrap().catch(() => {
  console.error(
    'API startup failed. Check DATABASE_URL, PORT and whether the API port is available. See docs/development.md.',
  );
  process.exitCode = 1;
});
