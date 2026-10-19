import { Prisma } from '@prisma/client';
import type { PrismaService } from './prisma.service';

const scoped = new WeakSet<object>();

/** Reuse one real transaction across stock/ledger services; never open nested transactions. */
export function transactionPrisma(tx: Prisma.TransactionClient): PrismaService {
  const proxy: PrismaService = new Proxy(tx, {
    get(target, key) {
      if (key === '$transaction') {
        return (work: (client: PrismaService) => Promise<unknown>) =>
          work(proxy);
      }
      return Reflect.get(target, key) as unknown;
    },
  }) as PrismaService;
  scoped.add(proxy);
  return proxy;
}

export function isOrderTransaction(prisma: PrismaService): boolean {
  return scoped.has(prisma);
}

export async function withOrderTransaction<T>(
  prisma: PrismaService,
  orderId: string,
  work: (client: PrismaService) => Promise<T>,
): Promise<T> {
  if (scoped.has(prisma)) return work(prisma);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "EcommerceOrder" WHERE "id" = ${orderId} FOR UPDATE`;
          return work(transactionPrisma(tx));
        },
        {
          maxWait: 10000,
          timeout: 30000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !['P2034', 'P2002'].includes(error.code) ||
        attempt === 4
      )
        throw error;
    }
  }
  throw new Error('Order transaction retry limit exceeded');
}
