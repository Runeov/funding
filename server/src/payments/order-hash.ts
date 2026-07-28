import { createHash } from 'node:crypto';

export interface OrderHashInput {
  externalOrderId: string;
  externalUserId: string;
  itemRef: string;
  chain: string;
  expectedAmountAtomic: string;
  requiredConfirmations: number;
  expiresAt: string | null;
}

export function createOrderRequestHash(input: OrderHashInput): string {
  const canonical = JSON.stringify([
    input.externalOrderId,
    input.externalUserId,
    input.itemRef,
    input.chain,
    input.expectedAmountAtomic,
    input.requiredConfirmations,
    input.expiresAt,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
