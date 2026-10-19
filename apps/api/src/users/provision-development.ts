import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { PasswordService, validatePassword } from '../auth/password.service.js';
import { normalizeEmail } from './email.js';

/** Explicit development operation, never called by application startup/migrations. */
export async function provisionDevelopmentAccounts(
  client: PrismaClient,
  environment: NodeJS.ProcessEnv,
): Promise<{ created: number; existing: number }> {
  if (environment.NODE_ENV !== 'development') {
    throw new Error('Development provisioning requires NODE_ENV=development.');
  }
  const accounts = [
    {
      email: normalizeEmail(environment.DEV_ADMIN_EMAIL),
      password: environment.DEV_ADMIN_PASSWORD,
      role: 'ADMIN' as const,
    },
    {
      email: normalizeEmail(environment.DEV_OPERATOR_EMAIL),
      password: environment.DEV_OPERATOR_PASSWORD,
      role: 'OPERATOR' as const,
    },
  ];
  for (const account of accounts) validatePassword(account.password);
  if (accounts[0]!.email === accounts[1]!.email) {
    throw new Error(
      'Development accounts must have distinct normalized emails.',
    );
  }
  const passwords = new PasswordService();
  // Perform new password hashing before opening a transaction or taking locks.
  const prepared = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      passwordHash: await passwords.hash(account.password),
    })),
  );
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(
        async (tx) => {
          let created = 0;
          for (const account of prepared) {
            const existing = await tx.user.findUnique({
              where: { email: account.email },
              select: { role: true, active: true, passwordHash: true },
            });
            if (existing) {
              if (
                existing.role !== account.role ||
                !existing.active ||
                !(await passwords.verify(
                  existing.passwordHash,
                  account.password,
                ))
              ) {
                throw new Error(
                  'An existing development account conflicts with the requested password, role, or active status.',
                );
              }
            } else {
              await tx.user.create({
                data: {
                  email: account.email,
                  passwordHash: account.passwordHash,
                  role: account.role,
                },
                select: { id: true },
              });
              created++;
            }
          }
          // Only counts cross this boundary; hashes and credentials stay internal.
          return { created, existing: prepared.length - created };
        },
        { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 },
      );
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        continue;
      throw error;
    }
  }
}
