import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Request, Response, RequestHandler } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { ENVIRONMENT } from '../config/config.module.js';
import type { Environment } from '../config/environment.js';
import {
  AUTH_CONFIGURATION,
  type AuthConfiguration,
  ABSOLUTE_LIFETIME_MS,
  IDLE_LIFETIME_MS,
} from './auth.configuration.js';
import './session.types.js';

@Injectable()
export class SessionRuntime implements OnApplicationShutdown {
  readonly pool: Pool;
  readonly store: connectPgSimple.PGStore;
  readonly middleware: RequestHandler;
  readonly cookieName: string;
  private timer: NodeJS.Timeout | undefined;
  private cleanup: Promise<void> | undefined;
  private closing = false;

  constructor(
    @Inject(ENVIRONMENT) env: Environment,
    @Inject(AUTH_CONFIGURATION) readonly configuration: AuthConfiguration,
  ) {
    this.pool = new Pool({
      connectionString: env.databaseUrl,
      max: 4,
      connectionTimeoutMillis: 1000,
      query_timeout: 1500,
      statement_timeout: 1500,
    });
    this.pool.on('error', () => {
      /* Requests fail closed; never log driver details. */
    });
    const PgStore = connectPgSimple(session);
    this.store = new PgStore({
      pool: this.pool,
      tableName: 'http_session',
      createTableIfMissing: false,
      pruneSessionInterval: false,
      disableTouch: true,
      errorLog: () => {
        /* Never log session data or database errors. */
      },
    });
    this.cookieName = configuration.production
      ? '__Host-orderflow.sid'
      : 'orderflow.sid';
    const load = session({
      store: this.store,
      secret: configuration.secret,
      name: this.cookieName,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        path: '/',
        httpOnly: true,
        secure: configuration.production,
        sameSite: 'lax',
        maxAge: IDLE_LIFETIME_MS,
      },
    });
    this.middleware = (req, res, next) => {
      if (req.path === '/health/live' || req.path === '/health/ready') {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (configuration.production && !req.secure) {
        res
          .status(403)
          .json({ statusCode: 403, message: 'HTTPS is required.' });
        return;
      }
      load(req, res, (error) => {
        if (error) {
          this.unavailable(res);
          return;
        }
        void this.expire(req, res)
          .then(() => next())
          .catch(() => this.unavailable(res));
      });
    };
    this.scheduleCleanup();
  }

  private unavailable(res: Response): void {
    res.status(503).json({
      statusCode: 503,
      message: 'Authentication storage unavailable.',
    });
  }

  async operation(
    action: (done: (error?: unknown) => void) => void,
  ): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) =>
        action((error) => (error ? reject(error) : resolve())),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Authentication storage unavailable.',
      );
    }
  }

  private async expire(req: Request, res: Response): Promise<void> {
    const state = req.session;
    if (
      state.createdAt === undefined &&
      state.lastSeen === undefined &&
      !state.userId
    )
      return;
    const now = Date.now();
    if (
      !Number.isFinite(state.createdAt) ||
      !Number.isFinite(state.lastSeen) ||
      now - state.createdAt! >= ABSOLUTE_LIFETIME_MS ||
      now - state.lastSeen! >= IDLE_LIFETIME_MS
    ) {
      await this.operation((done) => state.regenerate(done));
      this.clearCookie(res);
    }
    if (req.session.createdAt !== undefined) {
      req.session.cookie.maxAge = Math.min(
        IDLE_LIFETIME_MS,
        Math.max(0, req.session.createdAt + ABSOLUTE_LIFETIME_MS - now),
      );
    }
  }

  /** Renew existing rows only: an in-flight request cannot recreate a logged-out session. */
  async touch(req: Request): Promise<boolean> {
    const now = Date.now();
    const until = Math.min(
      now + IDLE_LIFETIME_MS,
      (req.session.createdAt ?? 0) + ABSOLUTE_LIFETIME_MS,
    );
    try {
      const result = await this.pool.query(
        `UPDATE http_session
        SET sess = jsonb_set(sess::jsonb, '{lastSeen}', to_jsonb($2::bigint))::json,
            expire = to_timestamp($3::double precision / 1000)
        WHERE sid = $1 AND expire > CURRENT_TIMESTAMP
          AND (sess->>'createdAt')::bigint + $4 > $2
        RETURNING sid`,
        [req.sessionID, now, until, ABSOLUTE_LIFETIME_MS],
      );
      return result.rowCount === 1;
    } catch {
      throw new ServiceUnavailableException(
        'Authentication storage unavailable.',
      );
    }
  }

  async save(req: Request): Promise<void> {
    const now = Date.now();
    req.session.createdAt ??= now;
    req.session.lastSeen = now;
    req.session.cookie.maxAge = Math.min(
      IDLE_LIFETIME_MS,
      Math.max(0, req.session.createdAt + ABSOLUTE_LIFETIME_MS - now),
    );
    await this.operation((done) => req.session.save(done));
  }

  async destroy(req: Request, res: Response): Promise<void> {
    await this.operation((done) => req.session.destroy(done));
    this.clearCookie(res);
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, {
      path: '/',
      httpOnly: true,
      secure: this.configuration.production,
      sameSite: 'lax',
    });
  }

  async cleanupExpired(): Promise<void> {
    await this.pool.query(`DELETE FROM http_session WHERE sid IN (
      SELECT sid FROM http_session WHERE expire < CURRENT_TIMESTAMP
      ORDER BY expire LIMIT 500 FOR UPDATE SKIP LOCKED)`);
  }

  private scheduleCleanup(): void {
    if (this.closing) return;
    this.timer = setTimeout(() => {
      this.cleanup = this.cleanupExpired()
        .catch(() => {
          /* Retry next bounded tick. */
        })
        .finally(() => this.scheduleCleanup());
    }, 60000);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.timer);
    await this.cleanup;
    await this.store.close();
    await this.pool.end();
  }
}
