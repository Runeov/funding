import type { ChainTransactionStatus } from '@prisma/client';

export interface ChainTip {
  hash: string;
  height: number;
}

export interface ChainTransactionObservation {
  txid: string;
  status: ChainTransactionStatus;
  blockHash?: string;
  blockHeight?: number;
}

export interface ChainOutputObservation {
  txid: string;
  vout: number;
  amountAtomic: bigint;
}

export interface KnownChainTransaction {
  txid: string;
  status: ChainTransactionStatus;
  currentBlockHash: string | null;
}

export interface AddressScan {
  transactions: ChainTransactionObservation[];
  outputs: ChainOutputObservation[];
}

export interface UtxoChainProvider {
  verifyNetwork(expectedGenesisHash: string): Promise<void>;
  getTip(): Promise<ChainTip>;
  isBlockCanonical(blockHash: string): Promise<boolean>;
  scanAddressAtTip(
    address: string,
    knownTransactions: readonly KnownChainTransaction[],
    tip: ChainTip,
  ): Promise<AddressScan>;
}
