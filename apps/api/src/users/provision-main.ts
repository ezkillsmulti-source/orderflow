import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { readDatabaseUrl } from '../config/environment.js';
import { provisionDevelopmentAccounts } from './provision-development.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Development provisioning requires NODE_ENV=development.');
  }
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: readDatabaseUrl(process.env.DATABASE_URL),
      connectionTimeoutMillis: 3000,
    }),
  });
  try {
    const result = await provisionDevelopmentAccounts(client, process.env);
    console.log(
      `Development accounts: ${result.created} created, ${result.existing} unchanged.`,
    );
  } finally {
    await client.$disconnect();
  }
}

main().catch(() => {
  console.error(
    'Development account provisioning failed. Check NODE_ENV, credentials, database, and account conflicts; see docs/development.md.',
  );
  process.exitCode = 1;
});
