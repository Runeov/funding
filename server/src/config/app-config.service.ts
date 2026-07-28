import { Injectable } from '@nestjs/common';
import type {
  AddressType,
  Chain,
  ChainNetwork,
} from '@prisma/client';
import { validateAccountXpub } from '../wallet/derive';
import type { AccountWalletConfig } from '../wallet/types';

export interface PaymentMonitorConfig {
  enabled: boolean;
  intervalMs: number;
  concurrency: number;
  requestTimeoutMs: number;
  maxHistoryPages: number;
  batchSize: number;
  leaseMs: number;
  retentionDays: number;
}

export interface ChainProviderConfig {
  chain: Chain;
  network: ChainNetwork;
  baseUrl: string;
  genesisHash: string;
}

const MAINNET_GENESIS: Record<Chain, string> = {
  BITCOIN:
    '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  DOGECOIN:
    '1a91e3dace36e2be3bf030a65679fe821aa1d6ef92e7c9902eb318182c355691',
};

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error('Boolean environment values must be "true" or "false"');
}

function parseUrl(
  value: string | undefined,
  name: string,
  production: boolean,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const url = new URL(normalized);
  const loopback =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && !production && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `${name} must use HTTPS (loopback HTTP is allowed outside production) and contain no credentials`,
    );
  }
  return url.toString().replace(/\/$/, '');
}

function parseAccount(
  env: NodeJS.ProcessEnv,
  prefix: 'BITCOIN' | 'DOGECOIN',
  chain: Chain,
  defaults: {
    accountPath: string;
    addressType: AddressType;
  },
): AccountWalletConfig | undefined {
  const accountXpub = env[`${prefix}_ACCOUNT_XPUB`]?.trim();
  if (!accountXpub) {
    return undefined;
  }

  const keyRef = env[`${prefix}_ACCOUNT_KEY_REF`]?.trim();
  const masterFingerprint =
    env[`${prefix}_MASTER_FINGERPRINT`]?.trim().toLowerCase();
  if (!keyRef) {
    throw new Error(`${prefix}_ACCOUNT_KEY_REF is required when XPUB is set`);
  }
  if (!masterFingerprint) {
    throw new Error(
      `${prefix}_MASTER_FINGERPRINT is required when XPUB is set`,
    );
  }

  const config: AccountWalletConfig = {
    keyRef,
    accountXpub,
    accountPath:
      env[`${prefix}_ACCOUNT_PATH`]?.trim() || defaults.accountPath,
    masterFingerprint,
    chain,
    network: 'MAINNET' satisfies ChainNetwork,
    addressType: defaults.addressType,
  };
  validateAccountXpub(config);
  return config;
}

@Injectable()
export class AppConfigService {
  readonly port: number;
  readonly internalApiKey: string;
  readonly accounts: readonly AccountWalletConfig[];
  readonly providers: readonly ChainProviderConfig[];
  readonly paymentMonitor: Readonly<PaymentMonitorConfig>;

  constructor() {
    const env = process.env;
    const production = env.NODE_ENV === 'production';
    this.port = parseInteger(env.PORT, 3001, 'PORT', 1, 65535);
    this.internalApiKey = env.INTERNAL_API_KEY?.trim() ?? '';
    if (this.internalApiKey.length < 32) {
      throw new Error('INTERNAL_API_KEY must contain at least 32 characters');
    }

    const accounts = [
      parseAccount(env, 'BITCOIN', 'BITCOIN', {
        accountPath: "m/44'/0'/0'",
        addressType: 'P2PKH',
      }),
      parseAccount(env, 'DOGECOIN', 'DOGECOIN', {
        accountPath: "m/44'/3'/0'",
        addressType: 'P2PKH',
      }),
    ].filter((value): value is AccountWalletConfig => value !== undefined);

    if (accounts.length === 0) {
      throw new Error(
        'Configure at least one account-level XPUB; no private keys are accepted',
      );
    }
    if (new Set(accounts.map(({ keyRef }) => keyRef)).size !== accounts.length) {
      throw new Error('Every configured account must have a unique key reference');
    }
    this.accounts = Object.freeze(accounts);

    const providers = (
      [
        {
          chain: 'BITCOIN' as const,
          baseUrl: parseUrl(
            env.BITCOIN_ESPLORA_URL,
            'BITCOIN_ESPLORA_URL',
            production,
          ),
        },
        {
          chain: 'DOGECOIN' as const,
          baseUrl: parseUrl(
            env.DOGECOIN_ESPLORA_URL,
            'DOGECOIN_ESPLORA_URL',
            production,
          ),
        },
      ] satisfies Array<{ chain: Chain; baseUrl?: string }>
    )
      .filter(
        (provider): provider is { chain: Chain; baseUrl: string } =>
          provider.baseUrl !== undefined,
      )
      .map(
        ({ chain, baseUrl }): ChainProviderConfig => ({
          chain,
          network: 'MAINNET',
          baseUrl,
          genesisHash: MAINNET_GENESIS[chain],
        }),
      );
    this.providers = Object.freeze(providers);

    this.paymentMonitor = Object.freeze({
      enabled: parseBoolean(env.PAYMENT_MONITOR_ENABLED, false),
      intervalMs: parseInteger(
        env.PAYMENT_MONITOR_INTERVAL_MS,
        20_000,
        'PAYMENT_MONITOR_INTERVAL_MS',
        5_000,
        3_600_000,
      ),
      concurrency: parseInteger(
        env.PAYMENT_MONITOR_CONCURRENCY,
        4,
        'PAYMENT_MONITOR_CONCURRENCY',
        1,
        32,
      ),
      requestTimeoutMs: parseInteger(
        env.ESPLORA_REQUEST_TIMEOUT_MS,
        10_000,
        'ESPLORA_REQUEST_TIMEOUT_MS',
        1_000,
        120_000,
      ),
      maxHistoryPages: parseInteger(
        env.ESPLORA_MAX_HISTORY_PAGES,
        40,
        'ESPLORA_MAX_HISTORY_PAGES',
        1,
        1_000,
      ),
      batchSize: parseInteger(
        env.PAYMENT_MONITOR_BATCH_SIZE,
        100,
        'PAYMENT_MONITOR_BATCH_SIZE',
        1,
        1_000,
      ),
      leaseMs: parseInteger(
        env.PAYMENT_MONITOR_LEASE_MS,
        120_000,
        'PAYMENT_MONITOR_LEASE_MS',
        30_000,
        900_000,
      ),
      retentionDays: parseInteger(
        env.PAYMENT_MONITOR_RETENTION_DAYS,
        30,
        'PAYMENT_MONITOR_RETENTION_DAYS',
        1,
        365,
      ),
    });

    if (this.paymentMonitor.enabled) {
      const missing = this.accounts
        .map(({ chain }) => chain)
        .filter(
          (chain) => !this.providers.some((provider) => provider.chain === chain),
        );
      if (missing.length > 0) {
        throw new Error(
          `Payment monitoring requires an HTTPS Esplora endpoint for: ${[
            ...new Set(missing),
          ].join(', ')}`,
        );
      }
    }
  }

  accountByKeyRef(keyRef: string): AccountWalletConfig {
    const account = this.accounts.find((candidate) => candidate.keyRef === keyRef);
    if (!account) {
      throw new Error(`No configured account for key reference ${keyRef}`);
    }
    return account;
  }

  accountForChain(chain: Chain): AccountWalletConfig | undefined {
    return this.accounts.find(
      (account) => account.chain === chain && account.network === 'MAINNET',
    );
  }

  providerForChain(chain: Chain): ChainProviderConfig | undefined {
    return this.providers.find(
      (provider) =>
        provider.chain === chain && provider.network === 'MAINNET',
    );
  }
}
