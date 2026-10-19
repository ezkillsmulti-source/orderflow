export interface Environment {
  databaseUrl: string;
  port: number;
}

export function readDatabaseUrl(rawUrl: string | undefined): string {
  try {
    const url = new URL(rawUrl ?? '');
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      [...url.searchParams.keys()].some((key) => key !== 'sslmode')
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with host, database, user and password; only sslmode query options are supported.',
    );
  }
  return rawUrl!;
}

export function readEnvironment(env: NodeJS.ProcessEnv): Environment {
  const databaseUrl = readDatabaseUrl(env.DATABASE_URL);
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return { databaseUrl, port };
}
