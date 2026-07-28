export interface PaymentAmount {
  amountAtomic: bigint;
  confirmations: number;
}

export interface PaymentTotals {
  observedAtomic: bigint;
  confirmedAtomic: bigint;
}

export function totalPaymentAmounts(
  payments: readonly PaymentAmount[],
  requiredConfirmations: number,
): PaymentTotals {
  return payments.reduce<PaymentTotals>(
    (totals, payment) => ({
      observedAtomic: totals.observedAtomic + payment.amountAtomic,
      confirmedAtomic:
        totals.confirmedAtomic +
        (payment.confirmations >= requiredConfirmations
          ? payment.amountAtomic
          : 0n),
    }),
    { observedAtomic: 0n, confirmedAtomic: 0n },
  );
}

export interface ObservedChainPayment {
  amountAtomic: bigint;
  transaction: {
    status: ChainTransactionStatus;
    currentBlockHash: string | null;
    currentBlockHeight: number | null;
    inclusions: Array<{
      blockHash: string;
      blockHeight: number;
    }>;
  };
}

export function totalCanonicalPaymentAmounts(
  outputs: readonly ObservedChainPayment[],
  requiredConfirmations: number,
  tipHeight: number,
): PaymentTotals {
  const active = outputs.flatMap(({ amountAtomic, transaction }) => {
    if (transaction.status === ChainTransactionStatus.MEMPOOL) {
      return [{ amountAtomic, confirmations: 0 }];
    }
    const canonical = transaction.inclusions[0];
    if (
      transaction.status !== ChainTransactionStatus.CONFIRMED ||
      transaction.inclusions.length !== 1 ||
      canonical === undefined ||
      canonical.blockHash !== transaction.currentBlockHash ||
      canonical.blockHeight !== transaction.currentBlockHeight
    ) {
      return [];
    }
    return [
      {
        amountAtomic,
        confirmations: Math.max(0, tipHeight - canonical.blockHeight + 1),
      },
    ];
  });
  return totalPaymentAmounts(active, requiredConfirmations);
}
import { ChainTransactionStatus } from '@prisma/client';
