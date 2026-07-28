import { describe, expect, it } from 'vitest';
import { createOrderRequestHash } from './order-hash';

const order = {
  externalOrderId: 'order-1',
  externalUserId: 'user-1',
  itemRef: 'nft-1',
  chain: 'BITCOIN',
  expectedAmountAtomic: '1000',
  requiredConfirmations: 3,
  expiresAt: null,
};

describe('order idempotency hash', () => {
  it('is stable for identical immutable input', () => {
    expect(createOrderRequestHash(order)).toBe(createOrderRequestHash(order));
  });

  it('changes when an immutable field changes', () => {
    expect(createOrderRequestHash(order)).not.toBe(
      createOrderRequestHash({
        ...order,
        expectedAmountAtomic: '1001',
      }),
    );
  });
});
