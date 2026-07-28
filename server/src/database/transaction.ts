import { Prisma } from '@prisma/client';
import type { PrismaService } from './prisma.service';

export type TransactionClient = Prisma.TransactionClient;

export async function runSerializable<T>(
  prisma: PrismaService,
  callback: (transaction: TransactionClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034';
      if (!retryable || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }

  throw new Error('Unreachable transaction retry state');
}
