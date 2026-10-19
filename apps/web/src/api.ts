export interface Identity {
  id: string;
  email: string;
  role: 'ADMIN' | 'OPERATOR';
}
export interface SessionState {
  phase: 'checking' | 'anonymous' | 'authenticated' | 'unavailable';
  user: Identity | null;
  generation: number;
}
export class Cancelled extends Error {}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly uncertain = false,
    readonly retryAfter = 0,
  ) {
    const messages: Record<number, string> = {
      0: 'The service could not be reached.',
      400: 'Check the form values and try again.',
      401: 'Your session has ended. Please sign in again.',
      403: 'This request was forbidden. Your permissions or security token may have changed. Review the page before trying again.',
      404: 'This product could not be found.',
      409: 'The product could not be saved. Its SKU may be in use, or it may have been archived. Refresh to check its current state.',
      413: 'The request is too large.',
      429: 'Too many requests. Please wait before trying again.',
      500: 'The service is temporarily unavailable.',
      502: 'The service returned an unreadable response.',
      503: 'The service is temporarily unavailable.',
    };
    super(
      (messages[status] ?? 'The request could not be completed.') +
        (uncertain
          ? ' The change may have reached the server. Check the catalog before submitting it again.'
          : ''),
    );
  }
}
function identity(value: unknown): Identity {
  const user = value as Partial<Identity> | null;
  if (
    !user ||
    typeof user.id !== 'string' ||
    typeof user.email !== 'string' ||
    !['ADMIN', 'OPERATOR'].includes(user.role ?? '')
  )
    throw new ApiError(502);
  return {
    id: user.id,
    email: user.email,
    role: user.role as Identity['role'],
  };
}
export class SessionClient {
  private state: SessionState = {
    phase: 'checking',
    user: null,
    generation: 0,
  };
  private epoch = 0;
  private csrfToken: string | undefined;
  private csrfPending: Promise<string> | undefined;
  private pending = new Set<AbortController>();
  private listeners = new Set<() => void>();
  constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(
    phase: SessionState['phase'],
    user: Identity | null,
    reset = false,
  ) {
    this.state = {
      phase,
      user,
      generation: this.state.generation + (reset ? 1 : 0),
    };
    this.listeners.forEach((listener) => listener());
  }
  private boundary() {
    this.epoch++;
    this.pending.forEach((controller) => controller.abort());
    this.pending.clear();
    this.csrfToken = undefined;
    this.csrfPending = undefined;
  }
  private invalidate() {
    this.boundary();
    this.publish('anonymous', null, true);
  }
  private async raw<T>(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    const epoch = this.epoch;
    const controller = new AbortController();
    this.pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    const unsafe = method !== 'GET';
    try {
      let response: Response;
      try {
        response = await this.fetcher(`/api${path}`, {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
            ...(unsafe && this.csrfToken
              ? { 'X-CSRF-Token': this.csrfToken }
              : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        if (epoch !== this.epoch) throw new Cancelled();
        throw new ApiError(0, unsafe);
      }
      const data: unknown =
        response.status === 204
          ? undefined
          : await response.json().catch(() => undefined);
      if (epoch !== this.epoch) throw new Cancelled();
      if (!response.ok) {
        const seconds = Number(response.headers.get('Retry-After') ?? 0);
        throw new ApiError(
          response.status,
          unsafe && response.status >= 500,
          Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600
            ? seconds
            : 0,
        );
      }
      if (response.status !== 204 && data === undefined)
        throw new ApiError(502, unsafe);
      return data as T;
    } finally {
      clearTimeout(timeout);
      this.pending.delete(controller);
    }
  }
  private token(): Promise<string> {
    if (this.csrfToken) return Promise.resolve(this.csrfToken);
    if (!this.csrfPending) {
      const epoch = this.epoch;
      this.csrfPending = this.raw<{ csrfToken: string }>('/auth/csrf')
        .then((result) => {
          if (epoch !== this.epoch) throw new Cancelled();
          if (typeof result.csrfToken !== 'string' || !result.csrfToken)
            throw new ApiError(502);
          this.csrfToken = result.csrfToken;
          return result.csrfToken;
        })
        .finally(() => {
          if (epoch === this.epoch) this.csrfPending = undefined;
        });
    }
    return this.csrfPending;
  }
  async restore() {
    this.boundary();
    const epoch = this.epoch;
    this.publish('checking', null, true);
    try {
      const result = await this.raw<{ user: Identity }>('/auth/me');
      if (epoch === this.epoch)
        this.publish('authenticated', identity(result.user));
    } catch (error) {
      if (error instanceof Cancelled || epoch !== this.epoch) return;
      if (error instanceof ApiError && error.status === 401) this.invalidate();
      else this.publish('unavailable', null, true);
    }
  }
  async login(email: string, password: string) {
    this.boundary();
    const epoch = this.epoch;
    await this.token();
    if (epoch !== this.epoch) throw new Cancelled();
    const result = await this.raw<{ user: Identity; csrfToken: string }>(
      '/auth/login',
      'POST',
      { email, password },
    );
    if (epoch !== this.epoch) throw new Cancelled();
    if (typeof result.csrfToken !== 'string' || !result.csrfToken)
      throw new ApiError(502, true);
    this.csrfToken = result.csrfToken;
    this.publish('authenticated', identity(result.user), true);
  }
  async logout() {
    this.boundary();
    const epoch = this.epoch;
    try {
      await this.token();
      if (epoch !== this.epoch) throw new Cancelled();
      await this.raw('/auth/logout', 'POST');
      if (epoch !== this.epoch) throw new Cancelled();
      this.invalidate();
    } catch (error) {
      if (epoch !== this.epoch) throw new Cancelled();
      if (error instanceof ApiError && error.status === 401) this.invalidate();
      else if (error instanceof ApiError && error.status === 403)
        await this.forbidden();
      throw error;
    }
  }
  /** Refresh identity after 403, without treating every denial as a CSRF failure. */
  private async forbidden() {
    const epoch = this.epoch;
    this.csrfToken = undefined;
    try {
      const result = await this.raw<{ user: Identity }>('/auth/me');
      if (epoch !== this.epoch) throw new Cancelled();
      const current = identity(result.user);
      if (
        current.id !== this.state.user?.id ||
        current.role !== this.state.user?.role
      ) {
        this.boundary();
        this.publish('authenticated', current, true);
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof ApiError && error.status === 401) this.invalidate();
      // An outage is not evidence that the session ended. Never replay the mutation.
    }
  }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const epoch = this.epoch;
    try {
      if (method !== 'GET') await this.token();
      if (epoch !== this.epoch) throw new Cancelled();
      const result = await this.raw<T>(path, method, body);
      if (epoch !== this.epoch) throw new Cancelled();
      return result;
    } catch (error) {
      if (epoch !== this.epoch) throw new Cancelled();
      if (error instanceof ApiError && error.status === 401) this.invalidate();
      else if (error instanceof ApiError && error.status === 403)
        await this.forbidden();
      throw error;
    }
  }
}
export const session = new SessionClient();
