import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENVIRONMENT } from '../config/config.module.js';
import type { Environment } from '../config/environment.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: PrismaClient;
  private probe: Promise<boolean> | undefined;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: environment.databaseUrl,
        max: 2,
        connectionTimeoutMillis: 1000,
        query_timeout: 1000,
        statement_timeout: 1000,
      }),
    });
  }

  isReady(): Promise<boolean> {
    if (this.probe) return this.probe;
    const query = this.client.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    this.probe = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 1500);
      void query.then((ready) => {
        clearTimeout(timer);
        this.probe = undefined;
        resolve(ready);
      });
    });
    // After the deadline, reuse the settled false result until the underlying
    // query finishes. New requests add no observers to a stalled query.
    return this.probe;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
