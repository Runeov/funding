import { describe, expect, it } from 'vitest';
import { ChainTransactionStatus } from '@prisma/client';
import {
  totalCanonicalPaymentAmounts,
  totalPaymentAmounts,
} from './balance';

describe('payment amount totals', () => {
  it('separates observed and sufficiently confirmed amounts', () => {
    expect(
      totalPaymentAmounts(
        [
          { amountAtomic: 40n, confirmations: 0 },
          { amountAtomic: 60n, confirmations: 3 },
          { amountAtomic: 10n, confirmations: 10 },
        ],
        3,
      ),
    ).toEqual({
      observedAtomic: 110n,
      confirmedAtomic: 70n,
    });
  });

  it('counts confirmations only from the one matching canonical inclusion', () => {
    const blockHash = 'a'.repeat(64);
    expect(
      totalCanonicalPaymentAmounts(
        [
          {
            amountAtomic: 60n,
            transaction: {
              status: ChainTransactionStatus.CONFIRMED,
              currentBlockHash: blockHash,
              currentBlockHeight: 98,
              inclusions: [{ blockHash, blockHeight: 98 }],
            },
          },
          {
            amountAtomic: 40n,
            transaction: {
              status: ChainTransactionStatus.CONFIRMED,
              currentBlockHash: 'b'.repeat(64),
              currentBlockHeight: 98,
              inclusions: [{ blockHash, blockHeight: 98 }],
            },
          },
          {
            amountAtomic: 5n,
            transaction: {
              status: ChainTransactionStatus.MEMPOOL,
              currentBlockHash: null,
              currentBlockHeight: null,
              inclusions: [],
            },
          },
        ],
        3,
        100,
      ),
    ).toEqual({
      observedAtomic: 65n,
      confirmedAtomic: 60n,
    });
  });
});
