import {
  AddressPurpose,
  AddressType,
  Chain,
  ChainNetwork,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service';

const configuredAccount = {
  keyRef: 'bitcoin-test',
  accountXpub: 'not-used-by-this-service-test',
  accountPath: "m/44'/0'/0'",
  masterFingerprint: '3442193e',
  chain: Chain.BITCOIN,
  network: ChainNetwork.MAINNET,
  addressType: AddressType.P2PKH,
};

function createConfig() {
  return {
    paymentMonitor: {
      enabled: true,
      retentionDays: 30,
      batchSize: 100,
    },
    accountForChain: vi.fn().mockReturnValue(configuredAccount),
    providerForChain: vi.fn().mockReturnValue({
      chain: Chain.BITCOIN,
      network: ChainNetwork.MAINNET,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PaymentsService launch safeguards', () => {
  it('stores the three-confirmation floor and derives a finite expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));

    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => {
          const payment = data.paymentIntent.create;
          return {
            id: 'c46a898f-5181-4eab-9e29-1007bd70ef2b',
            externalOrderId: data.externalOrderId,
            itemRef: data.itemRef,
            status: OrderStatus.AWAITING_PAYMENT,
            createdAt: new Date(),
            paymentIntent: {
              id: 'a742b50e-e238-4de4-8bc7-eb4150c8143e',
              expectedAtomic: payment.expectedAtomic,
              observedAtomic: 0n,
              confirmedAtomic: 0n,
              requiredConfirmations: payment.requiredConfirmations,
              status: PaymentStatus.AWAITING,
              expiresAt: payment.expiresAt,
              paidAt: null,
              depositAddress: {
                chain: Chain.BITCOIN,
                address: '1NQpH6Nf8QtR2HphLRcvuVqfhXBXsiWn8r',
                derivationPath: "m/44'/0'/0'/0/1",
              },
            },
          };
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: '98f07cfa-8d10-4c40-8a2b-e66aa1ea706d',
        }),
      },
      hdAccount: {
        findUnique: vi.fn().mockResolvedValue({
          id: '101e3c49-91bc-41ac-929d-c05a4db79200',
          keyRef: configuredAccount.keyRef,
          chain: Chain.BITCOIN,
          network: ChainNetwork.MAINNET,
          addressType: AddressType.P2PKH,
        }),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation(async (callback) => callback(transaction)),
    };
    const wallets = {
      ensureUserWallet: vi.fn().mockResolvedValue({
        id: 'cb3f1fc9-c993-4cbc-b70f-d20933aa8a4a',
      }),
      allocateOrderDepositAddress: vi.fn().mockResolvedValue({
        id: 'bd56e81d-08b9-4439-9202-c5447f8735aa',
        purpose: AddressPurpose.ORDER_DEPOSIT,
      }),
    };
    const service = new PaymentsService(
      prisma as never,
      createConfig() as never,
      wallets as never,
    );

    const result = await service.createOrder({
      externalOrderId: 'order-1',
      externalUserId: 'user-1',
      itemRef: 'funder-1',
      chain: 'bitcoin',
      expectedAmountAtomic: '1000',
      requiredConfirmations: 1,
    });

    expect(result.payment.requiredConfirmations).toBe(3);
    expect(result.payment.expiresAt).toBe(
      '2026-08-27T12:00:00.000Z',
    );
    const createData =
      transaction.order.create.mock.calls[0][0].data.paymentIntent.create;
    expect(createData.requiredConfirmations).toBe(3);
    expect(createData.monitorUntil.toISOString()).toBe(
      '2026-09-26T12:00:00.000Z',
    );
  });

  it('routes an unfinished monitoring window to review with an outbox event', async () => {
    const monitorUntil = new Date('2026-07-27T12:00:00.000Z');
    const orderId = 'c46a898f-5181-4eab-9e29-1007bd70ef2b';
    const paymentIntentId = 'a742b50e-e238-4de4-8bc7-eb4150c8143e';
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue({
          id: paymentIntentId,
          orderId,
          status: PaymentStatus.AWAITING,
          observedAtomic: 0n,
          confirmedAtomic: 0n,
          settlementEpoch: 0,
          monitorUntil,
          order: {
            id: orderId,
            status: OrderStatus.AWAITING_PAYMENT,
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      order: {
        update: vi.fn().mockResolvedValue({}),
      },
      outboxEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      paymentIntent: {
        findMany: vi.fn().mockResolvedValue([{ id: paymentIntentId }]),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (callback) => callback(transaction)),
    };
    const service = new PaymentsService(
      prisma as never,
      createConfig() as never,
      {} as never,
    );

    await expect(
      service.finalizePastMonitoringWindows(
        new Date('2026-07-28T12:00:00.000Z'),
      ),
    ).resolves.toBe(1);
    expect(transaction.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: paymentIntentId },
      data: {
        status: PaymentStatus.REVIEW,
        stateVersion: { increment: 1 },
      },
    });
    expect(transaction.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: OrderStatus.REVIEW },
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: `payment.monitoring-ended:${paymentIntentId}`,
        topic: 'payment.review',
        aggregateId: orderId,
      }),
    });
  });
});
