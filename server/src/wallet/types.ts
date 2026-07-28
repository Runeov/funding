import type {
  AddressType,
  Chain,
  ChainNetwork,
} from '@prisma/client';

export const MAX_NON_HARDENED_INDEX = 0x7fffffff;

export interface AccountWalletConfig {
  keyRef: string;
  accountXpub: string;
  accountPath: string;
  masterFingerprint: string;
  chain: Chain;
  network: ChainNetwork;
  addressType: AddressType;
}

export interface DerivedWalletAddress {
  address: string;
  publicKeyHex: string;
  relativePath: string;
  derivationPath: string;
  index: number;
}

export interface AccountPath {
  purpose: number;
  coinType: number;
  account: number;
}

export interface PublicWalletView {
  id: string;
  userId: string;
  chain: Lowercase<Chain>;
  network: Lowercase<ChainNetwork>;
  index: number;
  address: string;
  publicKey: string;
  derivationPath: string;
  createdAt: string;
}
