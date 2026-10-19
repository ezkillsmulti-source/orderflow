import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { normalizeEmail } from '../users/email.js';
import { PasswordService, validatePassword } from './password.service.js';
import { LoginThrottle } from './login-throttle.js';
import { SessionRuntime } from './session.runtime.js';
import { RequestProtection } from './request-protection.js';

@Injectable()
export class AuthenticationService implements OnModuleInit {
  private dummyHash!: string;
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly throttle: LoginThrottle,
    private readonly sessions: SessionRuntime,
    private readonly protection: RequestProtection,
  ) {}
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash(randomBytes(32).toString('hex'));
  }
  async login(req: Request, input: unknown) {
    let email: string;
    let password: string;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error();
      const body = input as Record<string, unknown>;
      if (Object.keys(body).some((key) => !['email', 'password'].includes(key)))
        throw new Error();
      email = normalizeEmail(body.email);
      validatePassword(body.password);
      password = body.password;
    } catch {
      throw new BadRequestException('Invalid request.');
    }
    await this.throttle.login(
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
      email,
    );
    const user = await this.database.client.user
      .findUnique({ where: { email } })
      .catch(() => {
        throw new ServiceUnavailableException(
          'Authentication storage unavailable.',
        );
      });
    const matches = await this.passwords.verify(
      user?.passwordHash ?? this.dummyHash,
      password,
    );
    if (!user?.active || !matches)
      throw new UnauthorizedException('Invalid email or password.');
    await this.sessions.operation((done) => req.session.regenerate(done));
    req.session.userId = user.id;
    const csrfToken = this.protection.csrf.generateToken(req, true);
    await this.sessions.save(req);
    return {
      user: { id: user.id, email: user.email, role: user.role },
      csrfToken,
    };
  }
}
