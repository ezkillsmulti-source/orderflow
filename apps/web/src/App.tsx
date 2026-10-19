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
        <p className="eyebrow">A clearer working day</p>
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
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          Order<span>Flow</span>
        </a>
        {state.user && (
          <div className="row">
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
      </header>
      <main id="main" className="page">
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
