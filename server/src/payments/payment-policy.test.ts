import { OrderStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  deriveOrderExpiry,
  enforceConfirmationFloor,
  finalizeMonitoringWindow,
} from './payment-policy';

describe('launch payment policy', () => {
  it.each([
    { requested: 1, effective: 3 },
    { requested: 2, effective: 3 },
    { requested: 3, effective: 3 },
    { requested: 12, effective: 12 },
  ])(
    'enforces at least three confirmations for $requested',
    ({ requested, effective }) => {
      expect(enforceConfirmationFloor(requested)).toBe(effective);
    },
  );

  it('derives a finite expiry when the caller omits one', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    expect(deriveOrderExpiry(null, now, 30).toISOString()).toBe(
      '2026-08-27T12:00:00.000Z',
    );
  });

  it('preserves an explicit expiry', () => {
    const requested = new Date('2026-07-29T12:00:00.000Z');
    expect(
      deriveOrderExpiry(
        requested,
        new Date('2026-07-28T12:00:00.000Z'),
        30,
      ),
    ).toBe(requested);
  });

  it('closes a cleanly expired order', () => {
    expect(
      finalizeMonitoringWindow({
        paymentStatus: PaymentStatus.EXPIRED,
        orderStatus: OrderStatus.AWAITING_PAYMENT,
        observedAtomic: 0n,
        confirmedAtomic: 0n,
        settlementEpoch: 0,
      }),
    ).toEqual({
      paymentStatus: PaymentStatus.EXPIRED,
      orderStatus: OrderStatus.CANCELLED,
      eventTopic: 'payment.expired',
    });
  });

  it.each([
    PaymentStatus.AWAITING,
    PaymentStatus.PARTIAL,
    PaymentStatus.CONFIRMING,
    PaymentStatus.REORGED,
  ])(
    'routes an unfinished %s window to manual review',
    (paymentStatus) => {
      expect(
        finalizeMonitoringWindow({
          paymentStatus,
          orderStatus: OrderStatus.AWAITING_PAYMENT,
          observedAtomic:
            paymentStatus === PaymentStatus.AWAITING ? 0n : 1n,
          confirmedAtomic: 0n,
          settlementEpoch:
            paymentStatus === PaymentStatus.REORGED ? 1 : 0,
        }),
      ).toEqual({
        paymentStatus: PaymentStatus.REVIEW,
        orderStatus: OrderStatus.REVIEW,
        eventTopic: 'payment.review',
      });
    },
  );

  it('does not alter a paid payment after monitoring ends', () => {
    expect(
      finalizeMonitoringWindow({
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.FULFILLED,
        observedAtomic: 100n,
        confirmedAtomic: 100n,
        settlementEpoch: 1,
      }),
    ).toBeNull();
  });
});
