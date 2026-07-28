import type { AddressType, Chain } from '@prisma/client';
import { BIP32Factory } from 'bip32';
import { payments } from 'bitcoinjs-lib';
import { createHash } from 'node:crypto';
import * as ecc from 'tiny-secp256k1';
import { networkFor } from './address';
import {
  MAX_NON_HARDENED_INDEX,
  type AccountPath,
  type AccountWalletConfig,
  type DerivedWalletAddress,
} from './types';

const bip32 = BIP32Factory(ecc);
const HARDENED_OFFSET = 0x80000000;
const ACCOUNT_PATH_PATTERN = /^m\/(\d+)'\/(\d+)'\/(\d+)'$/;

export class InvalidBip32ChildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBip32ChildError';
  }
}

export function parseAccountPath(path: string): AccountPath {
  const match = ACCOUNT_PATH_PATTERN.exec(path);
  if (!match) {
    throw new Error(
      `Account path must be hardened and end at account depth, for example m/44'/0'/0'`,
    );
  }

  const [, purposeText, coinTypeText, accountText] = match;
  const result = {
    purpose: Number(purposeText),
    coinType: Number(coinTypeText),
    account: Number(accountText),
  };

  for (const [name, value] of Object.entries(result)) {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > MAX_NON_HARDENED_INDEX
    ) {
      throw new Error(`Invalid ${name} component in account path`);
    }
  }

  return result;
}

function validatePurpose(
  chain: Chain,
  addressType: AddressType,
  path: AccountPath,
): void {
  const expectedCoinType = chain === 'BITCOIN' ? 0 : 3;
  if (path.coinType !== expectedCoinType) {
    throw new Error(
      `${chain} account path must use SLIP-44 coin type ${expectedCoinType}`,
    );
  }

  if (chain === 'DOGECOIN') {
    if (path.purpose !== 44 || addressType !== 'P2PKH') {
      throw new Error('Dogecoin supports only BIP44 P2PKH in this service');
    }
    return;
  }

  const expectedPurpose = addressType === 'P2WPKH' ? 84 : 44;
  if (path.purpose !== expectedPurpose) {
    throw new Error(
      `${addressType} must use BIP${expectedPurpose} purpose ${expectedPurpose}'`,
    );
  }
}

export function validateAccountXpub(config: AccountWalletConfig): void {
  if (!/^[0-9a-fA-F]{8}$/.test(config.masterFingerprint)) {
    throw new Error('Master fingerprint must be exactly 8 hexadecimal digits');
  }

  const path = parseAccountPath(config.accountPath);
  validatePurpose(config.chain, config.addressType, path);

  const account = bip32.fromBase58(
    config.accountXpub,
    networkFor(config.chain, config.network),
  );

  if (!account.isNeutered()) {
    throw new Error('Extended private keys are forbidden in the wallet service');
  }
  if (account.depth !== 3) {
    throw new Error('Expected an account-level XPUB at BIP32 depth 3');
  }
  if (account.index !== HARDENED_OFFSET + path.account) {
    throw new Error('XPUB account index does not match ACCOUNT_PATH');
  }
  const external = account.derive(0);
  if (external.index !== 0) {
    throw new Error('The XPUB cannot derive the standard external branch 0');
  }
}

export function deriveAddress(
  config: AccountWalletConfig,
  index: number,
): DerivedWalletAddress {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > MAX_NON_HARDENED_INDEX
  ) {
    throw new Error(
      `Address index must be an integer from 0 to ${MAX_NON_HARDENED_INDEX}`,
    );
  }

  validateAccountXpub(config);
  const network = networkFor(config.chain, config.network);
  const account = bip32.fromBase58(config.accountXpub, network);
  const external = account.derive(0);
  if (external.index !== 0) {
    throw new Error('BIP32 skipped the requested external branch');
  }

  const child = external.derive(index);
  if (child.index !== index) {
    throw new InvalidBip32ChildError(
      'BIP32 skipped an invalid child; the allocated index cannot be used',
    );
  }

  const payment =
    config.addressType === 'P2WPKH'
      ? payments.p2wpkh({ pubkey: child.publicKey, network })
      : payments.p2pkh({ pubkey: child.publicKey, network });

  if (!payment.address) {
    throw new Error('Address generation failed');
  }

  return {
    address: payment.address,
    publicKeyHex: Buffer.from(child.publicKey).toString('hex'),
    relativePath: `0/${index}`,
    derivationPath: `${config.accountPath}/0/${index}`,
    index,
  };
}

export function hashAccountXpub(accountXpub: string): string {
  return createHash('sha256').update(accountXpub, 'utf8').digest('hex');
}
