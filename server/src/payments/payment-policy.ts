import { OrderStatus, PaymentStatus } from '@prisma/client';

export const MIN_REQUIRED_CONFIRMATIONS = 3;

export function enforceConfirmationFloor(requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error('requiredConfirmations must be a positive integer');
  }
  return Math.max(requested, MIN_REQUIRED_CONFIRMATIONS);
}

export function deriveOrderExpiry(
  requested: Date | null,
  now: Date,
  retentionDays: number,
): Date {
  if (requested) {
    return requested;
  }
  return new Date(
    now.getTime() + retentionDays * 24 * 60 * 60 * 1_000,
  );
}

export interface MonitoringWindowState {
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  observedAtomic: bigint;
  confirmedAtomic: bigint;
  settlementEpoch: number;
}

export interface MonitoringWindowFinalization {
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  eventTopic: 'payment.expired' | 'payment.review';
}

export function finalizeMonitoringWindow(
  state: MonitoringWindowState,
): MonitoringWindowFinalization | null {
  if (state.paymentStatus === PaymentStatus.PAID) {
    return null;
  }
  if (
    state.paymentStatus === PaymentStatus.REVIEW &&
    state.orderStatus === OrderStatus.REVIEW
  ) {
    return null;
  }

  const hasPaymentActivity =
    state.observedAtomic > 0n ||
    state.confirmedAtomic > 0n ||
    state.settlementEpoch > 0;
  const orderAdvanced =
    state.orderStatus === OrderStatus.PAID ||
    state.orderStatus === OrderStatus.RESERVED ||
    state.orderStatus === OrderStatus.FULFILLED ||
    state.orderStatus === OrderStatus.REVIEW;

  if (
    !hasPaymentActivity &&
    !orderAdvanced &&
    (state.paymentStatus === PaymentStatus.EXPIRED ||
      state.paymentStatus === PaymentStatus.CANCELLED)
  ) {
    return {
      paymentStatus: state.paymentStatus,
      orderStatus: OrderStatus.CANCELLED,
      eventTopic: 'payment.expired',
    };
  }

  return {
    paymentStatus: PaymentStatus.REVIEW,
    orderStatus: OrderStatus.REVIEW,
    eventTopic: 'payment.review',
  };
}
