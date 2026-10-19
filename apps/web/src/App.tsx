import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { ApiError, Cancelled, session } from './api';
import { Catalog } from './Catalog';
import { ErrorNotice, useCooldown } from './feedback';

function Login() {
  const emailInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    emailInput.current?.focus();
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const blocked = useCooldown(error);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    (form.elements.namedItem('password') as HTMLInputElement).value = '';
    setBusy(true);
    setError(null);
    try {
      await session.login(email, password);
    } catch (error) {
      if (!(error instanceof Cancelled))
        setError(
          error instanceof ApiError && error.status === 401
            ? Object.assign(new ApiError(401), {
                message: 'Invalid email or password.',
              })
            : error instanceof ApiError
              ? error
              : new ApiError(0),
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-intro">
        <p className="eyebrow">Your product workspace</p>
        <h1>
          Your catalog.
          <br />
          In good order.
        </h1>
        <p className="muted">
          A focused workspace for your products and the people who manage them.
        </p>
      </section>
      <section className="card login-card" aria-labelledby="login-title">
        <h2 id="login-title">Sign in to OrderFlow</h2>
        <p className="muted">Use your business account to continue.</p>
        <form
          className="stack"
          onSubmit={(event) => {
            void submit(event);
          }}
          aria-busy={busy}
        >
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              ref={emailInput}
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              disabled={busy}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </div>
          <ErrorNotice error={error} />
          <button className="primary" disabled={busy || blocked}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-footer">
          For your team. For the details that matter.
        </p>
      </section>
    </div>
  );
}
export function App() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void session.restore();
  }, []);
  useEffect(() => {
    heading.current?.focus();
    setError(null);
  }, [state.generation]);
  useEffect(() => {
    if (state.phase === 'anonymous') window.location.hash = '#products';
  }, [state.phase]);
  async function logout() {
    setLoggingOut(true);
    setError(null);
    try {
      await session.logout();
    } catch (error) {
      if (!(error instanceof Cancelled))
        setError(error instanceof ApiError ? error : new ApiError(0));
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a
            className="brand"
            href={state.user ? '#products' : '/'}
            aria-label="OrderFlow home"
          >
            <span className="brand-mark" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5l8 4.5 8-4.5 M12 12v9 M8 5.25l8 4.5" />
              </svg>
            </span>
            <span>OrderFlow</span>
          </a>
          {state.user && (
            <nav className="app-nav" aria-label="Application">
              <a href="#products" aria-current="page">
                Products
              </a>
            </nav>
          )}
          {state.user && (
            <div className="account-menu">
              <div className="identity">
                {state.user.email}
                <span className="role">
                  {state.user.role === 'ADMIN' ? 'Administrator' : 'Operator'}
                </span>
              </div>
              <button
                onClick={() => {
                  void logout();
                }}
                disabled={loggingOut}
              >
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        <ErrorNotice error={error} />
        {state.phase === 'checking' || loggingOut ? (
          <p role="status">
            {loggingOut ? 'Signing out…' : 'Checking your session…'}
          </p>
        ) : state.phase === 'unavailable' ? (
          <section className="card">
            <h1 ref={heading} tabIndex={-1}>
              Service unavailable
            </h1>
            <p>
              We could not check your session. Your account has not been signed
              out.
            </p>
            <button
              onClick={() => {
                void session.restore();
              }}
            >
              Try again
            </button>
          </section>
        ) : state.phase === 'anonymous' ? (
          <Login key={state.generation} />
        ) : (
          <Catalog key={state.generation} user={state.user!} />
        )}
      </main>
    </>
  );
}
