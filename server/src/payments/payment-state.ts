import { PaymentStatus } from '@prisma/client';

export interface PaymentStateInput {
  currentStatus: PaymentStatus;
  expectedAtomic: bigint;
  observedAtomic: bigint;
  confirmedAtomic: bigint;
  expired: boolean;
}

export function nextPaymentStatus(input: PaymentStateInput): PaymentStatus {
  if (input.currentStatus === PaymentStatus.REVIEW) {
    return PaymentStatus.REVIEW;
  }
  if (input.currentStatus === PaymentStatus.CANCELLED) {
    return input.observedAtomic > 0n
      ? PaymentStatus.REVIEW
      : PaymentStatus.CANCELLED;
  }
  if (input.currentStatus === PaymentStatus.REORGED) {
    return input.confirmedAtomic >= input.expectedAtomic
      ? PaymentStatus.PAID
      : PaymentStatus.REORGED;
  }
  if (input.currentStatus === PaymentStatus.PAID) {
    return input.confirmedAtomic >= input.expectedAtomic
      ? PaymentStatus.PAID
      : PaymentStatus.REORGED;
  }
  if (
    (input.currentStatus === PaymentStatus.EXPIRED || input.expired)
  ) {
    return input.observedAtomic > 0n
      ? PaymentStatus.REVIEW
      : PaymentStatus.EXPIRED;
  }
  if (input.confirmedAtomic >= input.expectedAtomic) {
    return PaymentStatus.PAID;
  }
  if (input.observedAtomic === 0n) {
    return PaymentStatus.AWAITING;
  }
  if (input.observedAtomic < input.expectedAtomic) {
    return PaymentStatus.PARTIAL;
  }
  return PaymentStatus.CONFIRMING;
}
