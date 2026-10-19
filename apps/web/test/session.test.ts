import { describe, expect, it, vi } from 'vitest';
import { ApiError, Cancelled, SessionClient } from '../src/api';
const user = { id: 'user', email: 'user@example.test', role: 'ADMIN' };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function setup() {
  const fetcher = vi.fn<typeof fetch>();
  const client = new SessionClient(fetcher);
  return { fetcher, client };
}
async function login(
  fetcher: ReturnType<typeof setup>['fetcher'],
  client: SessionClient,
) {
  fetcher
    .mockResolvedValueOnce(json({ csrfToken: 'before' }))
    .mockResolvedValueOnce(json({ user, csrfToken: 'after' }));
  await client.login('user@example.test', 'synthetic passphrase');
}
describe('session and API boundary', () => {
  it('uses the actual CSRF contract, rotation and same-origin cookies', async () => {
    const { fetcher, client } = setup();
    await login(fetcher, client);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': 'before' },
    });
    fetcher.mockResolvedValueOnce(json({}));
    await client.request('/products', 'POST', { priceMinor: '0' });
    expect(fetcher.mock.calls[2]![1]?.headers).toMatchObject({
      'X-CSRF-Token': 'after',
    });
  });
  it('distinguishes an unavailable identity store from an anonymous session', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValueOnce(json({}, 503));
    await client.restore();
    expect(client.getSnapshot().phase).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({}, 401));
    await client.restore();
    expect(client.getSnapshot().phase).toBe('anonymous');
  });
  it('keeps identity on failed logout and never retries the mutation', async () => {
    const { fetcher, client } = setup();
    await login(fetcher, client);
    fetcher
      .mockResolvedValueOnce(json({ csrfToken: 'logout' }))
      .mockRejectedValueOnce(new Error('private details'));
    await expect(client.logout()).rejects.toMatchObject({ uncertain: true });
    expect(client.getSnapshot().user).toEqual(user);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('discards an old response after confirmed logout even if fetch ignores abort', async () => {
    const { fetcher, client } = setup();
    await login(fetcher, client);
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = client.request('/products').catch((error: unknown) => error);
    fetcher
      .mockResolvedValueOnce(json({ csrfToken: 'logout' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.logout();
    finish(json({ items: ['private data'] }));
    expect(await old).toBeInstanceOf(Cancelled);
    expect(client.getSnapshot().user).toBeNull();
  });
  it('invalidates protected 401, but refreshes role on 403 without mutation replay', async () => {
    const { fetcher, client } = setup();
    await login(fetcher, client);
    fetcher
      .mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(json({ user: { ...user, role: 'OPERATOR' } }));
    await expect(
      client.request('/products', 'POST', {}),
    ).rejects.toBeInstanceOf(ApiError);
    expect(client.getSnapshot().user?.role).toBe('OPERATOR');
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockResolvedValueOnce(json({}, 401));
    await expect(client.request('/products')).rejects.toMatchObject({
      status: 401,
    });
    expect(client.getSnapshot().phase).toBe('anonymous');
  });
  it('does not leak transport details or automatically replay uncertain creation', async () => {
    const { fetcher, client } = setup();
    await login(fetcher, client);
    fetcher.mockRejectedValueOnce(new Error('private driver details'));
    await expect(client.request('/products', 'POST', {})).rejects.toMatchObject(
      { status: 0, uncertain: true },
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
