import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChainTransactionStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  SettlementStatus,
  type Chain,
} from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import {
  runSerializable,
  type TransactionClient,
} from '../database/transaction';
import { totalCanonicalPaymentAmounts } from '../wallet/balance';
import { WalletService } from '../wallet/wallet.service';
import type { AddressScan, ChainTip } from './chain-provider';
import type { CreateOrderDto } from './dto/create-order.dto';
import { createOrderRequestHash } from './order-hash';
import { nextPaymentStatus } from './payment-state';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

type OrderWithPayment = Prisma.OrderGetPayload<{
  include: {
    paymentIntent: {
      include: {
        depositAddress: true;
      };
    };
  };
}>;

export interface OrderPaymentView {
  orderId: string;
  externalOrderId: string;
  itemRef: string;
  orderStatus: Lowercase<OrderStatus>;
  payment: {
    id: string;
    chain: Lowercase<Chain>;
    network: 'mainnet';
    address: string;
    derivationPath: string;
    expectedAmountAtomic: string;
    observedAmountAtomic: string;
    confirmedAmountAtomic: string;
    requiredConfirmations: number;
    status: Lowercase<PaymentStatus>;
    expiresAt: string | null;
    paidAt: string | null;
  };
  createdAt: string;
}

export interface ReconcileLease {
  chain: Chain;
  network: 'MAINNET';
  leaseOwner: string;
}

async function lockOrder(
  transaction: TransactionClient,
  externalOrderId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${'order:' + externalOrderId}, 0)
    )
  `;
}

async function lockPaymentIntent(
  transaction: TransactionClient,
  paymentIntentId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${'payment:' + paymentIntentId}, 0)
    )
  `;
}

function mapOrder(order: OrderWithPayment): OrderPaymentView {
  const payment = order.paymentIntent;
  if (!payment) {
    throw new Error(`Order ${order.id} has no payment intent`);
  }

  return {
    orderId: order.id,
    externalOrderId: order.externalOrderId,
    itemRef: order.itemRef,
    orderStatus: order.status.toLowerCase() as Lowercase<OrderStatus>,
    payment: {
      id: payment.id,
      chain: payment.depositAddress.chain.toLowerCase() as Lowercase<Chain>,
      network: 'mainnet',
      address: payment.depositAddress.address,
      derivationPath: payment.depositAddress.derivationPath,
      expectedAmountAtomic: payment.expectedAtomic.toString(),
      observedAmountAtomic: payment.observedAtomic.toString(),
      confirmedAmountAtomic: payment.confirmedAtomic.toString(),
      requiredConfirmations: payment.requiredConfirmations,
      status: payment.status.toLowerCase() as Lowercase<PaymentStatus>,
      expiresAt: payment.expiresAt?.toISOString() ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
    },
    createdAt: order.createdAt.toISOString(),
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly wallets: WalletService,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<OrderPaymentView> {
    const chain = dto.chain.toUpperCase() as Chain;
    const expectedAtomic = BigInt(dto.expectedAmountAtomic);
    if (expectedAtomic > MAX_POSTGRES_BIGINT) {
      throw new BadRequestException('Payment amount exceeds database limits');
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const retentionMs =
      this.config.paymentMonitor.retentionDays * 24 * 60 * 60 * 1_000;
    const requestHash = createOrderRequestHash({
      externalOrderId: dto.externalOrderId,
      externalUserId: dto.externalUserId,
      itemRef: dto.itemRef,
      chain,
      expectedAmountAtomic: expectedAtomic.toString(),
      requiredConfirmations: dto.requiredConfirmations,
      expiresAt: expiresAt?.toISOString() ?? null,
    });

    return runSerializable(this.prisma, async (transaction) => {
      await lockOrder(transaction, dto.externalOrderId);
      const existing = await transaction.order.findUnique({
        where: { externalOrderId: dto.externalOrderId },
        include: {
          paymentIntent: { include: { depositAddress: true } },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException(
            'externalOrderId was already used with different order data',
          );
        }
        return mapOrder(existing);
      }
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      if (
        expiresAt &&
        expiresAt.getTime() > Date.now() + retentionMs
      ) {
        throw new BadRequestException(
          `expiresAt cannot be more than ${this.config.paymentMonitor.retentionDays} days in the future`,
        );
      }
      if (!this.config.paymentMonitor.enabled) {
        throw new ServiceUnavailableException(
          'Payment monitoring is disabled; refusing to issue a deposit address',
        );
      }

      const user = await transaction.user.findUnique({
        where: { externalId: dto.externalUserId },
      });
      if (!user) {
        throw new NotFoundException('Wallet-service user not found');
      }

      const configured = this.config.accountForChain(chain);
      if (!configured) {
        throw new BadRequestException(
          `${dto.chain} is not configured in the wallet service`,
        );
      }
      if (!this.config.providerForChain(chain)) {
        throw new ServiceUnavailableException(
          `${dto.chain} payment monitoring is not configured`,
        );
      }
      const account = await transaction.hdAccount.findUnique({
        where: { keyRef: configured.keyRef },
      });
      if (!account) {
        throw new Error(`HD account ${configured.keyRef} has not been initialized`);
      }

      const walletView = await this.wallets.ensureUserWallet(
        transaction,
        user.id,
        configured,
      );
      const depositAddress = await this.wallets.allocateOrderDepositAddress(
        transaction,
        walletView.id,
        account,
      );
      const monitorFrom = Math.max(expiresAt?.getTime() ?? 0, Date.now());
      const monitorUntil = new Date(monitorFrom + retentionMs);

      const order = await transaction.order.create({
        data: {
          externalOrderId: dto.externalOrderId,
          requestHash,
          userId: user.id,
          itemRef: dto.itemRef,
          paymentIntent: {
            create: {
              depositAddressId: depositAddress.id,
              expectedAtomic,
              requiredConfirmations: dto.requiredConfirmations,
              expiresAt,
              monitorUntil,
            },
          },
        },
        include: {
          paymentIntent: { include: { depositAddress: true } },
        },
      });
      return mapOrder(order);
    });
  }

  async getOrder(externalOrderId: string): Promise<OrderPaymentView> {
    const order = await this.prisma.order.findUnique({
      where: { externalOrderId },
      include: {
        paymentIntent: { include: { depositAddress: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return mapOrder(order);
  }

  async reconcilePaymentIntent(
    paymentIntentId: string,
    tip: ChainTip,
    scan: AddressScan,
    lease: ReconcileLease,
  ): Promise<void> {
    await runSerializable(this.prisma, async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`chain:${lease.chain}:${lease.network}`},
            0
          )
        )
      `;
      const validLease = await transaction.chainCursor.updateMany({
        where: {
          chain: lease.chain,
          network: lease.network,
          leaseOwner: lease.leaseOwner,
          leaseUntil: { gt: new Date() },
        },
        data: {
          tipHash: tip.hash,
          tipHeight: tip.height,
        },
      });
      if (validLease.count !== 1) {
        throw new Error('Monitor lease expired; rejecting stale chain scan');
      }

      await lockPaymentIntent(transaction, paymentIntentId);
      const intent = await transaction.paymentIntent.findUnique({
        where: { id: paymentIntentId },
        include: {
          depositAddress: true,
          order: true,
          settlements: {
            where: { status: SettlementStatus.ACTIVE },
          },
        },
      });
      if (!intent) {
        throw new Error(`Payment intent ${paymentIntentId} no longer exists`);
      }
      if (
        intent.depositAddress.chain !== lease.chain ||
        intent.depositAddress.network !== lease.network
      ) {
        throw new Error('Payment intent does not belong to the monitor lease');
      }

      const observedTransactions = new Map<
        string,
        Awaited<ReturnType<TransactionClient['chainTransaction']['upsert']>>
      >();
      const observedAt = new Date();

      for (const observation of scan.transactions) {
        if (observation.status === ChainTransactionStatus.UNKNOWN) {
          continue;
        }
        const confirmed =
          observation.status === ChainTransactionStatus.CONFIRMED;
        if (
          confirmed &&
          (!observation.blockHash ||
            observation.blockHeight === undefined)
        ) {
          throw new Error(
            `Confirmed transaction ${observation.txid} lacks block metadata`,
          );
        }

        const chainTransaction = await transaction.chainTransaction.upsert({
          where: {
            chain_network_txid: {
              chain: intent.depositAddress.chain,
              network: intent.depositAddress.network,
              txid: observation.txid,
            },
          },
          create: {
            chain: intent.depositAddress.chain,
            network: intent.depositAddress.network,
            txid: observation.txid,
            status: observation.status,
            currentBlockHash: confirmed ? observation.blockHash : null,
            currentBlockHeight: confirmed ? observation.blockHeight : null,
            lastSeenAt: observedAt,
          },
          update: {
            status: observation.status,
            currentBlockHash: confirmed ? observation.blockHash : null,
            currentBlockHeight: confirmed ? observation.blockHeight : null,
            lastSeenAt: observedAt,
          },
        });
        observedTransactions.set(observation.txid, chainTransaction);

        if (confirmed) {
          await transaction.txInclusion.updateMany({
            where: {
              transactionId: chainTransaction.id,
              canonical: true,
              blockHash: { not: observation.blockHash },
            },
            data: {
              canonical: false,
              orphanedAt: observedAt,
            },
          });
          await transaction.txInclusion.upsert({
            where: {
              transactionId_blockHash: {
                transactionId: chainTransaction.id,
                blockHash: observation.blockHash!,
              },
            },
            create: {
              transactionId: chainTransaction.id,
              blockHash: observation.blockHash!,
              blockHeight: observation.blockHeight!,
              canonical: true,
            },
            update: {
              blockHeight: observation.blockHeight!,
              canonical: true,
              orphanedAt: null,
            },
          });
        } else {
          await transaction.txInclusion.updateMany({
            where: {
              transactionId: chainTransaction.id,
              canonical: true,
            },
            data: {
              canonical: false,
              orphanedAt: observedAt,
            },
          });
        }
      }

      for (const output of scan.outputs) {
        const chainTransaction = observedTransactions.get(output.txid);
        if (!chainTransaction) {
          throw new Error(
            `Output ${output.txid}:${output.vout} has no status observation`,
          );
        }
        const existing = await transaction.observedUtxo.findUnique({
          where: {
            transactionId_vout: {
              transactionId: chainTransaction.id,
              vout: output.vout,
            },
          },
        });
        if (
          existing &&
          (existing.addressId !== intent.depositAddressId ||
            existing.paymentIntentId !== intent.id ||
            existing.amountAtomic !== output.amountAtomic)
        ) {
          throw new Error(
            `Immutable output ${output.txid}:${output.vout} changed`,
          );
        }

        if (existing) {
          await transaction.observedUtxo.update({
            where: { id: existing.id },
            data: { lastSeenAt: observedAt },
          });
        } else {
          await transaction.observedUtxo.create({
            data: {
              transactionId: chainTransaction.id,
              vout: output.vout,
              addressId: intent.depositAddressId,
              paymentIntentId: intent.id,
              amountAtomic: output.amountAtomic,
              lastSeenAt: observedAt,
            },
          });
        }
      }

      const outputs = await transaction.observedUtxo.findMany({
        where: { paymentIntentId: intent.id },
        include: {
          transaction: {
            include: {
              inclusions: { where: { canonical: true } },
            },
          },
        },
      });
      const totals = totalCanonicalPaymentAmounts(
        outputs,
        intent.requiredConfirmations,
        tip.height,
      );

      const nextStatus =
        intent.order.status === OrderStatus.REVIEW
          ? PaymentStatus.REVIEW
          : nextPaymentStatus({
              currentStatus: intent.status,
              expectedAtomic: intent.expectedAtomic,
              observedAtomic: totals.observedAtomic,
              confirmedAtomic: totals.confirmedAtomic,
              expired:
                intent.expiresAt !== null &&
                intent.expiresAt.getTime() <= Date.now(),
            });
      const enteringPaid =
        nextStatus === PaymentStatus.PAID &&
        intent.status !== PaymentStatus.PAID;
      const leavingPaid =
        intent.status === PaymentStatus.PAID &&
        nextStatus !== PaymentStatus.PAID;

      let settlementEpoch = intent.settlementEpoch;
      if (leavingPaid) {
        for (const settlement of intent.settlements) {
          await transaction.paymentSettlement.update({
            where: { id: settlement.id },
            data: {
              status: SettlementStatus.REVERSED,
              reversedAt: observedAt,
              reversalTipHash: tip.hash,
            },
          });
          await transaction.outboxEvent.create({
            data: {
              eventKey: `payment.reversed:${intent.id}:${settlement.epoch}`,
              topic: 'payment.reversed',
              aggregateId: intent.orderId,
              payload: {
                orderId: intent.orderId,
                paymentIntentId: intent.id,
                settlementEpoch: settlement.epoch,
                tipHash: tip.hash,
              },
            },
          });
        }

        await transaction.order.update({
          where: { id: intent.orderId },
          data: {
            status:
              intent.order.status === OrderStatus.FULFILLED
                ? OrderStatus.REVIEW
                : OrderStatus.AWAITING_PAYMENT,
          },
        });
      }

      if (enteringPaid) {
        settlementEpoch += 1;
        await transaction.paymentSettlement.create({
          data: {
            paymentIntentId: intent.id,
            epoch: settlementEpoch,
            amountAtomic: totals.confirmedAtomic,
            qualifiedTipHash: tip.hash,
            qualifiedAtHeight: tip.height,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            eventKey: `payment.confirmed:${intent.id}:${settlementEpoch}`,
            topic: 'payment.confirmed',
            aggregateId: intent.orderId,
            payload: {
              orderId: intent.orderId,
              paymentIntentId: intent.id,
              settlementEpoch,
              confirmedAmountAtomic: totals.confirmedAtomic.toString(),
              tipHash: tip.hash,
              tipHeight: tip.height,
            },
          },
        });
        await transaction.order.update({
          where: { id: intent.orderId },
          data: { status: OrderStatus.PAID },
        });
      } else if (nextStatus === PaymentStatus.REVIEW) {
        await transaction.order.update({
          where: { id: intent.orderId },
          data: { status: OrderStatus.REVIEW },
        });
      }

      await transaction.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: nextStatus,
          observedAtomic: totals.observedAtomic,
          confirmedAtomic: totals.confirmedAtomic,
          stateVersion: { increment: 1 },
          settlementEpoch,
          lastEvaluatedTipHash: tip.hash,
          lastScannedAt: observedAt,
          monitorUntil:
            enteringPaid &&
            intent.monitorUntil.getTime() <
              observedAt.getTime() +
                this.config.paymentMonitor.retentionDays *
                  24 *
                  60 *
                  60 *
                  1_000
              ? new Date(
                  observedAt.getTime() +
                    this.config.paymentMonitor.retentionDays *
                      24 *
                      60 *
                      60 *
                      1_000,
                )
              : intent.monitorUntil,
          paidAt:
            nextStatus === PaymentStatus.PAID
              ? intent.paidAt ?? observedAt
              : null,
          reorgedAt:
            nextStatus === PaymentStatus.REORGED
              ? intent.reorgedAt ?? observedAt
              : null,
        },
      });
    });
  }
}
