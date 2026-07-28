import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AddressPurpose,
  type HdAccount,
  type Prisma,
} from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import type { TransactionClient } from '../database/transaction';
import { PrismaService } from '../database/prisma.service';
import {
  deriveAddress,
  hashAccountXpub,
  InvalidBip32ChildError,
} from './derive';
import {
  MAX_NON_HARDENED_INDEX,
  type AccountWalletConfig,
  type PublicWalletView,
} from './types';

@Injectable()
export class WalletService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncConfiguredAccounts();
    if (this.config.paymentMonitor.enabled) {
      const outstanding = await this.prisma.derivedAddress.findMany({
        where: {
          paymentIntent: { monitorUntil: { gt: new Date() } },
        },
        select: { chain: true },
        distinct: ['chain'],
      });
      const missing = outstanding
        .map(({ chain }) => chain)
        .filter((chain) => !this.config.providerForChain(chain));
      if (missing.length > 0) {
        throw new Error(
          `Outstanding payments require an Esplora endpoint for: ${[
            ...new Set(missing),
          ].join(', ')}`,
        );
      }
    }
  }

  async syncConfiguredAccounts(): Promise<void> {
    for (const configured of this.config.accounts) {
      const xpubHash = hashAccountXpub(configured.accountXpub);
      const existing = await this.prisma.hdAccount.upsert({
        where: { keyRef: configured.keyRef },
        create: {
          keyRef: configured.keyRef,
          xpubHash,
          masterFingerprint: configured.masterFingerprint,
          accountPath: configured.accountPath,
          chain: configured.chain,
          network: configured.network,
          addressType: configured.addressType,
        },
        update: {},
      });

      const mismatch =
        existing.xpubHash !== xpubHash ||
        existing.masterFingerprint !== configured.masterFingerprint ||
        existing.accountPath !== configured.accountPath ||
        existing.chain !== configured.chain ||
        existing.network !== configured.network ||
        existing.addressType !== configured.addressType;

      if (mismatch) {
        throw new Error(
          `HD account metadata changed for ${configured.keyRef}; rotate to a new key reference`,
        );
      }
    }
  }

  async ensureUserWallet(
    transaction: TransactionClient,
    userId: string,
    configured: AccountWalletConfig,
  ): Promise<PublicWalletView> {
    const account = await transaction.hdAccount.findUnique({
      where: { keyRef: configured.keyRef },
    });
    if (!account) {
      throw new Error(`HD account ${configured.keyRef} has not been initialized`);
    }

    const wallet = await transaction.wallet.upsert({
      where: {
        userId_hdAccountId: {
          userId,
          hdAccountId: account.id,
        },
      },
      create: {
        userId,
        hdAccountId: account.id,
      },
      update: {},
    });

    let receiveAddress = await transaction.derivedAddress.findFirst({
      where: {
        walletId: wallet.id,
        purpose: AddressPurpose.USER_RECEIVE,
        retiredAt: null,
      },
      orderBy: { derivationIndex: 'asc' },
    });

    receiveAddress ??= await this.allocateAddress(
      transaction,
      account,
      wallet.id,
      AddressPurpose.USER_RECEIVE,
    );

    return {
      id: wallet.id,
      userId,
      chain: account.chain.toLowerCase() as PublicWalletView['chain'],
      network: account.network.toLowerCase() as PublicWalletView['network'],
      index: receiveAddress.derivationIndex,
      address: receiveAddress.address,
      publicKey: receiveAddress.publicKeyHex,
      derivationPath: receiveAddress.derivationPath,
      createdAt: wallet.createdAt.toISOString(),
    };
  }

  async allocateOrderDepositAddress(
    transaction: TransactionClient,
    walletId: string,
    account: HdAccount,
  ) {
    return this.allocateAddress(
      transaction,
      account,
      walletId,
      AddressPurpose.ORDER_DEPOSIT,
    );
  }

  private async allocateAddress(
    transaction: TransactionClient,
    account: HdAccount,
    walletId: string,
    purpose: AddressPurpose,
  ) {
    const configured = this.config.accountByKeyRef(account.keyRef);
    const limit = BigInt(MAX_NON_HARDENED_INDEX) + 1n;

    for (let skippedChildren = 0; skippedChildren < 100; skippedChildren += 1) {
      const allocated = await transaction.$queryRaw<Array<{ index: bigint }>>`
        UPDATE "HdAccount"
        SET "nextExternalIndex" = "nextExternalIndex" + 1,
            "updatedAt" = NOW()
        WHERE "id" = ${account.id}::uuid
          AND "nextExternalIndex" < ${limit}
        RETURNING "nextExternalIndex" - 1 AS "index"
      `;

      if (allocated.length !== 1) {
        throw new Error(`External address space exhausted for ${account.keyRef}`);
      }

      const index = Number(allocated[0].index);
      try {
        const derived = deriveAddress(configured, index);
        return await transaction.derivedAddress.create({
          data: {
            hdAccountId: account.id,
            walletId,
            chain: account.chain,
            network: account.network,
            purpose,
            branch: 0,
            derivationIndex: index,
            derivationPath: derived.derivationPath,
            address: derived.address,
            publicKeyHex: derived.publicKeyHex,
          },
        });
      } catch (error) {
        if (!(error instanceof InvalidBip32ChildError)) {
          throw error;
        }
      }
    }

    throw new Error('Too many consecutive invalid BIP32 children');
  }
}
