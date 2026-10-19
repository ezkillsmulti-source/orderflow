import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readEnvironment, type Environment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  // Validate before Nest starts logging; invalid values are never echoed.
  let environment: Environment;
  try {
    environment = readEnvironment(process.env);
  } catch (error) {
    // readEnvironment throws fixed field descriptions, never input values.
    console.error(`API startup failed: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  app.enableShutdownHooks();
  await app.listen(environment.port, '127.0.0.1');
}

bootstrap().catch(() => {
  console.error(
    'API startup failed. Check DATABASE_URL, PORT and whether the API port is available. See docs/development.md.',
  );
  process.exitCode = 1;
});
