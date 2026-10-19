import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { DatabaseService } from '../src/database/database.service.js';

let database: DatabaseService | undefined;
afterEach(async () => {
  jest.restoreAllMocks();
  await database?.onApplicationShutdown();
});

describe('database probe', () => {
  function create(): DatabaseService {
    database = new DatabaseService({
      databaseUrl: 'postgresql://test:placeholder@127.0.0.1:1/test',
      port: 3000,
    });
    return database;
  }
  it('contains driver errors and disconnects during shutdown', async () => {
    const service = create();
    jest
      .spyOn(service.client, '$queryRaw')
      .mockRejectedValue(new Error('private connection details'));
    const disconnect = jest
      .spyOn(service.client, '$disconnect')
      .mockResolvedValue();
    expect(await service.isReady()).toBe(false);
    await service.onApplicationShutdown();
    expect(disconnect).toHaveBeenCalled();
  });
  it('shares a single deadline and releases stalled work before recovery', async () => {
    const service = create();
    let settle!: (value: unknown[]) => void;
    const query = jest
      .spyOn(service.client, '$queryRaw')
      .mockImplementationOnce(
        () =>
          new Promise<unknown[]>((resolve) => {
            settle = resolve;
          }) as never,
      )
      .mockResolvedValueOnce([{ value: 1 }]);
    const first = service.isReady();
    expect(service.isReady()).toBe(first);
    const start = performance.now();
    expect(await first).toBe(false);
    expect(performance.now() - start).toBeLessThan(2500);
    for (let attempt = 0; attempt < 100; attempt++) {
      // No new race/timeout/observer is created for late callers.
      expect(service.isReady()).toBe(first);
      expect(await service.isReady()).toBe(false);
    }
    expect(query).toHaveBeenCalledTimes(1);
    settle([]);
    // Flush the query continuation before checking that a fresh probe is allowed.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await service.isReady()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
