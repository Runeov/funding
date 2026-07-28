import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { runSerializable } from '../database/transaction';

const DELIVERY_LEASE_MS = 60_000;

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(limit: number) {
    return runSerializable(this.prisma, async (transaction) => {
      const available = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "publishedAt" IS NULL
          AND "nextAttemptAt" <= NOW()
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (available.length === 0) {
        return [];
      }

      const ids = available.map(({ id }) => id);
      const deliveryToken = randomUUID();
      const leaseUntil = new Date(Date.now() + DELIVERY_LEASE_MS);
      await transaction.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          leaseToken: deliveryToken,
          leaseUntil,
          attempts: { increment: 1 },
        },
      });
      const events = await transaction.outboxEvent.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'asc' },
      });

      return events.map((event) => ({
        id: event.id,
        eventKey: event.eventKey,
        topic: event.topic,
        aggregateId: event.aggregateId,
        payload: event.payload,
        deliveryToken,
        leaseUntil: leaseUntil.toISOString(),
        createdAt: event.createdAt.toISOString(),
      }));
    });
  }

  async acknowledge(
    id: string,
    deliveryToken: string,
  ): Promise<{ acknowledged: true }> {
    const updated = await this.prisma.outboxEvent.updateMany({
      where: {
        id,
        publishedAt: null,
        leaseToken: deliveryToken,
        leaseUntil: { gt: new Date() },
      },
      data: {
        publishedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (updated.count === 1) {
      return { acknowledged: true };
    }

    const existing = await this.prisma.outboxEvent.findUnique({
      where: { id },
      select: { publishedAt: true },
    });
    if (!existing) {
      throw new NotFoundException('Outbox event not found');
    }
    if (existing.publishedAt) {
      return { acknowledged: true };
    }
    throw new ConflictException('Outbox delivery token is invalid or expired');
  }
}
