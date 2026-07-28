import { PaymentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { nextPaymentStatus } from './payment-state';

const base = {
  currentStatus: PaymentStatus.AWAITING,
  expectedAtomic: 100n,
  observedAtomic: 0n,
  confirmedAtomic: 0n,
  expired: false,
};

describe('payment state machine', () => {
  it.each([
    {
      values: {},
      expected: PaymentStatus.AWAITING,
    },
    {
      values: { observedAtomic: 50n },
      expected: PaymentStatus.PARTIAL,
    },
    {
      values: { observedAtomic: 100n },
      expected: PaymentStatus.CONFIRMING,
    },
    {
      values: { observedAtomic: 100n, confirmedAtomic: 100n },
      expected: PaymentStatus.PAID,
    },
    {
      values: {
        currentStatus: PaymentStatus.PAID,
        observedAtomic: 100n,
        confirmedAtomic: 0n,
      },
      expected: PaymentStatus.REORGED,
    },
    {
      values: {
        currentStatus: PaymentStatus.REORGED,
        observedAtomic: 100n,
        confirmedAtomic: 100n,
        expired: true,
      },
      expected: PaymentStatus.PAID,
    },
    {
      values: { expired: true },
      expected: PaymentStatus.EXPIRED,
    },
    {
      values: {
        currentStatus: PaymentStatus.EXPIRED,
        observedAtomic: 100n,
        confirmedAtomic: 100n,
      },
      expected: PaymentStatus.REVIEW,
    },
    {
      values: {
        currentStatus: PaymentStatus.CANCELLED,
        observedAtomic: 1n,
      },
      expected: PaymentStatus.REVIEW,
    },
  ])('returns $expected', ({ values, expected }) => {
    expect(nextPaymentStatus({ ...base, ...values })).toBe(expected);
  });
});
