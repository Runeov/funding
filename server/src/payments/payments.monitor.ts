import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Chain, ChainNetwork } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  AppConfigService,
  type ChainProviderConfig,
} from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import type {
  AddressScan,
  KnownChainTransaction,
  UtxoChainProvider,
} from './chain-provider';
import { EsploraProvider } from './esplora.provider';
import { PaymentsService } from './payments.service';

interface ScannedIntent {
  id: string;
  scan: AddressScan;
}

@Injectable()
export class PaymentsMonitor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentsMonitor.name);
  private interval?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly payments: PaymentsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.paymentMonitor.enabled) {
      this.logger.log('Blockchain payment monitoring is disabled');
      return;
    }

    this.interval = setInterval(
      () => void this.tick(),
      this.config.paymentMonitor.intervalMs,
    );
    this.interval.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  async scanAll(): Promise<void> {
    for (const providerConfig of this.config.providers) {
      try {
        await this.scanChain(providerConfig);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown provider error';
        this.logger.error(
          `${providerConfig.chain} provider scan failed: ${message}`,
        );
      }
    }
  }

  private async scanChain(
    providerConfig: ChainProviderConfig,
  ): Promise<void> {
    const intents = await this.prisma.paymentIntent.findMany({
      where: {
        monitorUntil: { gt: new Date() },
        depositAddress: {
          chain: providerConfig.chain,
          network: providerConfig.network,
        },
      },
      include: {
        depositAddress: true,
        utxos: {
          include: {
            transaction: {
              select: {
                txid: true,
                status: true,
                currentBlockHash: true,
              },
            },
          },
        },
      },
      orderBy: [
        { lastScannedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ],
      take: this.config.paymentMonitor.batchSize,
    });
    if (intents.length === 0) {
      return;
    }

    const leaseOwner = randomUUID();
    if (
      !(await this.acquireLease(
        providerConfig.chain,
        providerConfig.network,
        leaseOwner,
      ))
    ) {
      return;
    }

    try {
      const provider = this.providerFor(providerConfig);
      await provider.verifyNetwork(providerConfig.genesisHash);
      const tip = await provider.getTip();
      await this.assertTipProgression(providerConfig, provider, tip);
      const scanned = await this.mapLimited(intents, async (intent) => {
        const knownByTxid = new Map<string, KnownChainTransaction>();
        for (const { transaction } of intent.utxos) {
          knownByTxid.set(transaction.txid, transaction);
        }
        return {
          id: intent.id,
          scan: await provider.scanAddressAtTip(
            intent.depositAddress.address,
            [...knownByTxid.values()],
            tip,
          ),
        } satisfies ScannedIntent;
      });

      const finalTip = await provider.getTip();
      if (finalTip.hash !== tip.hash || finalTip.height !== tip.height) {
        throw new Error('Chain tip changed during the batch; retrying next tick');
      }

      for (const result of scanned) {
        await this.payments.reconcilePaymentIntent(
          result.id,
          tip,
          result.scan,
          {
            chain: providerConfig.chain,
            network: providerConfig.network,
            leaseOwner,
          },
        );
      }
    } finally {
      await this.releaseLease(
        providerConfig.chain,
        providerConfig.network,
        leaseOwner,
      );
    }
  }

  private providerFor(config: ChainProviderConfig): UtxoChainProvider {
    return new EsploraProvider(
      config.baseUrl,
      this.config.paymentMonitor.requestTimeoutMs,
      this.config.paymentMonitor.maxHistoryPages,
    );
  }

  private async assertTipProgression(
    providerConfig: ChainProviderConfig,
    provider: UtxoChainProvider,
    tip: { hash: string; height: number },
  ): Promise<void> {
    const cursor = await this.prisma.chainCursor.findUnique({
      where: {
        chain_network: {
          chain: providerConfig.chain,
          network: providerConfig.network,
        },
      },
      select: { tipHash: true, tipHeight: true },
    });
    if (!cursor?.tipHash || cursor.tipHeight === null) {
      return;
    }
    if (cursor.tipHash === tip.hash) {
      if (cursor.tipHeight !== tip.height) {
        throw new Error('Provider changed the height of a known chain tip');
      }
      return;
    }

    const previousStillCanonical = await provider.isBlockCanonical(
      cursor.tipHash,
    );
    if (
      previousStillCanonical &&
      tip.height <= cursor.tipHeight
    ) {
      throw new Error('Provider returned a stale or conflicting chain tip');
    }
  }

  private async acquireLease(
    chain: Chain,
    network: ChainNetwork,
    leaseOwner: string,
  ): Promise<boolean> {
    const cursor = await this.prisma.chainCursor.upsert({
      where: { chain_network: { chain, network } },
      create: { chain, network },
      update: {},
    });
    const leaseUntil = new Date(
      Date.now() + this.config.paymentMonitor.leaseMs,
    );
    const acquired = await this.prisma.chainCursor.updateMany({
      where: {
        id: cursor.id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: { leaseOwner, leaseUntil },
    });
    return acquired.count === 1;
  }

  private async releaseLease(
    chain: Chain,
    network: ChainNetwork,
    leaseOwner: string,
  ): Promise<void> {
    await this.prisma.chainCursor.updateMany({
      where: { chain, network, leaseOwner },
      data: { leaseOwner: null, leaseUntil: null },
    });
  }

  private async mapLimited<T, R>(
    items: readonly T[],
    worker: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const runWorker = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            items.length,
            this.config.paymentMonitor.concurrency,
          ),
        },
        runWorker,
      ),
    );
    return results;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping overlapping payment monitor tick');
      return;
    }
    this.running = true;
    try {
      await this.scanAll();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown monitor error';
      this.logger.error(message);
    } finally {
      this.running = false;
    }
  }
}
