import { BadRequestException, Injectable } from '@nestjs/common';
import type { Chain } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import {
  runSerializable,
  type TransactionClient,
} from '../database/transaction';
import { WalletService } from '../wallet/wallet.service';
import type { PublicWalletView } from '../wallet/types';
import type { ApiChain, RegisterUserDto } from './dto/register-user.dto';

export interface UserProfile {
  id: string;
  externalUserId: string;
  wallets: PublicWalletView[];
  createdAt: string;
}

function toDatabaseChain(chain: ApiChain): Chain {
  return chain.toUpperCase() as Chain;
}

async function lockUser(
  transaction: TransactionClient,
  externalUserId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${'user:' + externalUserId}, 0)
    )
  `;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly wallets: WalletService,
  ) {}

  async register(dto: RegisterUserDto): Promise<UserProfile> {
    const requestedChains =
      dto.chains?.map(toDatabaseChain) ??
      this.config.accounts.map(({ chain }) => chain);
    const configuredAccounts = requestedChains.map((chain) => {
      const account = this.config.accountForChain(chain);
      if (!account) {
        throw new BadRequestException(
          `${chain.toLowerCase()} is not configured in the wallet service`,
        );
      }
      return account;
    });

    return runSerializable(this.prisma, async (transaction) => {
      await lockUser(transaction, dto.externalUserId);
      const user = await transaction.user.upsert({
        where: { externalId: dto.externalUserId },
        create: { externalId: dto.externalUserId },
        update: {},
      });

      const walletViews: PublicWalletView[] = [];
      for (const account of configuredAccounts) {
        walletViews.push(
          await this.wallets.ensureUserWallet(transaction, user.id, account),
        );
      }

      return {
        id: user.id,
        externalUserId: user.externalId,
        wallets: walletViews,
        createdAt: user.createdAt.toISOString(),
      };
    });
  }
}
