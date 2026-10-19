import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProductsModule } from '../products.module.js';
import { ImageCleanup } from './image.cleanup.js';

async function main() {
  const args = process.argv.slice(2);
  let limit = 100;
  let apply = false;
  let seenLimit = false;
  for (const arg of args) {
    if (arg === '--apply' && !apply) apply = true;
    else if (/^--limit=[1-9][0-9]{0,3}$/.test(arg) && !seenLimit) {
      limit = Number(arg.slice(8));
      seenLimit = true;
    } else throw new Error('Invalid arguments.');
  }
  if (limit > 1000) throw new Error('Invalid limit.');
  const app = await NestFactory.createApplicationContext(ProductsModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const result = await app.get(ImageCleanup).run(limit, apply);
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error(
    'Product image cleanup failed. Check configuration, storage access, and database availability.',
  );
  process.exitCode = 1;
});
