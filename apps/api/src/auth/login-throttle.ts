import {
  Injectable,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RateLimiterPostgres, RateLimiterRes } from 'rate-limiter-flexible';
import { SessionRuntime } from './session.runtime.js';

@Injectable()
export class LoginThrottle {
  private readonly admission: RateLimiterPostgres;
  private readonly source: RateLimiterPostgres;
  private readonly account: RateLimiterPostgres;
  constructor(sessions: SessionRuntime) {
    const common = {
      storeClient: sessions.pool,
      storeType: 'pool',
      tableName: 'login_limit',
      tableCreated: true,
      clearExpiredByTimeout: false,
    };
    this.admission = new RateLimiterPostgres({
      ...common,
      keyPrefix: 'admission',
      points: 200,
      duration: 60,
    });
    this.source = new RateLimiterPostgres({
      ...common,
      keyPrefix: 'source',
      points: 30,
      duration: 900,
    });
    this.account = new RateLimiterPostgres({
      ...common,
      keyPrefix: 'account',
      points: 10,
      duration: 900,
    });
  }
  private async consume(
    limiter: RateLimiterPostgres,
    key: string,
  ): Promise<void> {
    try {
      await limiter.consume(key);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw new HttpException(
          {
            statusCode: 429,
            message: 'Too many requests.',
            retryAfter: Math.max(1, Math.ceil(error.msBeforeNext / 1000)),
          },
          429,
        );
      }
      throw new ServiceUnavailableException(
        'Authentication storage unavailable.',
      );
    }
  }
  async admit(): Promise<void> {
    await this.consume(this.admission, 'all');
  }
  async login(ip: string, email: string): Promise<void> {
    await this.consume(this.source, ip);
    await this.consume(
      this.account,
      createHash('sha256').update(email).digest('hex'),
    );
  }
}
