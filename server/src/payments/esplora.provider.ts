import { ChainTransactionStatus } from '@prisma/client';
import JSONbig = require('json-bigint');
import type {
  AddressScan,
  ChainOutputObservation,
  ChainTip,
  ChainTransactionObservation,
  KnownChainTransaction,
  UtxoChainProvider,
} from './chain-provider';

const json = JSONbig({
  alwaysParseAsBig: true,
  useNativeBigInt: true,
});
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HISTORY_PAGE_SIZE = 25;
const PROVIDER_CONCURRENCY = 8;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Esplora ${context} response`);
  }
  return value as JsonRecord;
}

function asArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid Esplora ${context} response`);
  }
  return value;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid Esplora ${context} value`);
  }
  return value;
}

function asHash(value: unknown, context: string): string {
  const normalized = asString(value, context).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new Error(`Invalid Esplora ${context} value`);
  }
  return normalized;
}

function asInteger(value: unknown, context: string): number {
  const parsed =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid Esplora ${context} value`);
  }
  return parsed;
}

function asAtomicAmount(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) {
    return value;
  }
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  throw new Error('Invalid Esplora output amount');
}

async function mapLimited<T, R>(
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
      { length: Math.min(items.length, PROVIDER_CONCURRENCY) },
      runWorker,
    ),
  );
  return results;
}

export class EsploraProvider implements UtxoChainProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly requestTimeoutMs: number,
    private readonly maxHistoryPages: number,
  ) {}

  async verifyNetwork(expectedGenesisHash: string): Promise<void> {
    const actual = asHash(
      (await this.getText('/block-height/0')).trim(),
      'genesis hash',
    );
    if (actual !== expectedGenesisHash.toLowerCase()) {
      throw new Error(
        `Esplora genesis mismatch: expected ${expectedGenesisHash}, received ${actual}`,
      );
    }
  }

  async getTip(): Promise<ChainTip> {
    const hash = asHash(
      (await this.getText('/blocks/tip/hash')).trim(),
      'tip hash',
    );
    const block = asRecord(
      await this.getJson(`/block/${encodeURIComponent(hash)}`),
      'tip block',
    );
    if (asHash(block.id, 'tip block id') !== hash) {
      throw new Error('Esplora tip block does not match its reported hash');
    }
    if (!(await this.isBlockCanonical(hash))) {
      throw new Error('Esplora tip is not in the best chain');
    }
    return {
      hash,
      height: asInteger(block.height, 'tip height'),
    };
  }

  async scanAddressAtTip(
    address: string,
    knownTransactions: readonly KnownChainTransaction[],
    tip: ChainTip,
  ): Promise<AddressScan> {
    const encodedAddress = encodeURIComponent(address);
    const mempool = asArray(
      await this.getJson(`/address/${encodedAddress}/txs/mempool`),
      'mempool history',
    );
    const confirmed = await this.getConfirmedHistory(encodedAddress);
    const transactions = new Map<string, ChainTransactionObservation>();
    const outputs = new Map<string, ChainOutputObservation>();

    for (const rawTransaction of [...mempool, ...confirmed]) {
      this.collectTransaction(
        rawTransaction,
        address,
        transactions,
        outputs,
      );
    }

    const missingKnown = knownTransactions.filter(
      ({ txid }) => !transactions.has(txid.toLowerCase()),
    );
    const missingStatuses = await mapLimited(missingKnown, (known) =>
      this.getTransactionStatus(known),
    );
    for (const status of missingStatuses) {
      transactions.set(status.txid, status);
    }

    const confirmedTransactions = [...transactions.values()].filter(
      (
        observation,
      ): observation is ChainTransactionObservation & {
        blockHash: string;
        blockHeight: number;
      } =>
        observation.status === ChainTransactionStatus.CONFIRMED &&
        observation.blockHash !== undefined &&
        observation.blockHeight !== undefined,
    );
    const blockHashes = [
      ...new Set(confirmedTransactions.map(({ blockHash }) => blockHash)),
    ];
    const canonicalResults = await mapLimited(blockHashes, (blockHash) =>
      this.isBlockCanonical(blockHash),
    );
    if (canonicalResults.some((canonical) => !canonical)) {
      throw new Error(
        'Esplora transaction history changed chains during the scan',
      );
    }
    if (
      confirmedTransactions.some(
        ({ blockHeight }) => blockHeight > tip.height,
      )
    ) {
      throw new Error('Esplora returned a transaction above the snapshot tip');
    }

    return {
      transactions: [...transactions.values()],
      outputs: [...outputs.values()],
    };
  }

  private async getConfirmedHistory(encodedAddress: string): Promise<unknown[]> {
    const history: unknown[] = [];
    let lastSeenTxid: string | undefined;

    for (let pageNumber = 0; pageNumber < this.maxHistoryPages; pageNumber += 1) {
      const suffix = lastSeenTxid
        ? `/${encodeURIComponent(lastSeenTxid)}`
        : '';
      const page = asArray(
        await this.getJson(
          `/address/${encodedAddress}/txs/chain${suffix}`,
        ),
        'confirmed history',
      );
      history.push(...page);
      if (page.length < HISTORY_PAGE_SIZE) {
        return history;
      }

      const last = asRecord(page.at(-1), 'confirmed transaction');
      lastSeenTxid = asHash(last.txid, 'transaction id');
    }

    throw new Error(
      `Esplora history exceeded ${this.maxHistoryPages} pages; refusing a partial scan`,
    );
  }

  private collectTransaction(
    raw: unknown,
    address: string,
    transactions: Map<string, ChainTransactionObservation>,
    outputs: Map<string, ChainOutputObservation>,
  ): void {
    const transaction = asRecord(raw, 'transaction');
    const txid = asHash(transaction.txid, 'transaction id');
    const observation = this.parseStatus(txid, transaction.status);
    transactions.set(txid, observation);

    for (const [vout, rawOutput] of asArray(
      transaction.vout,
      'transaction outputs',
    ).entries()) {
      const output = asRecord(rawOutput, 'transaction output');
      if (output.scriptpubkey_address !== address) {
        continue;
      }
      outputs.set(`${txid}:${vout}`, {
        txid,
        vout,
        amountAtomic: asAtomicAmount(output.value),
      });
    }
  }

  private parseStatus(
    txid: string,
    rawStatus: unknown,
  ): ChainTransactionObservation {
    const status = asRecord(rawStatus, 'transaction status');
    if (status.confirmed === false) {
      return { txid, status: ChainTransactionStatus.MEMPOOL };
    }
    if (status.confirmed !== true) {
      throw new Error('Esplora transaction status lacks a valid confirmed flag');
    }

    return {
      txid,
      status: ChainTransactionStatus.CONFIRMED,
      blockHash: asHash(status.block_hash, 'block hash'),
      blockHeight: asInteger(status.block_height, 'block height'),
    };
  }

  private async getTransactionStatus(
    known: KnownChainTransaction,
  ): Promise<ChainTransactionObservation> {
    const txid = asHash(known.txid, 'known transaction id');
    const response = await this.request(
      `/tx/${encodeURIComponent(txid)}/status`,
    );
    if (response.status === 404) {
      if (
        known.status === ChainTransactionStatus.CONFIRMED &&
        known.currentBlockHash
      ) {
        const blockHash = asHash(
          known.currentBlockHash,
          'known transaction block hash',
        );
        if (!(await this.isBlockCanonical(blockHash))) {
          return { txid, status: ChainTransactionStatus.ORPHANED };
        }
      }
      return { txid, status: ChainTransactionStatus.UNKNOWN };
    }
    if (!response.ok) {
      throw new Error(
        `Esplora request failed with HTTP ${response.status}`,
      );
    }
    return this.parseStatus(txid, json.parse(await response.text()));
  }

  async isBlockCanonical(blockHash: string): Promise<boolean> {
    const status = asRecord(
      await this.getJson(
        `/block/${encodeURIComponent(blockHash)}/status`,
      ),
      'block status',
    );
    if (typeof status.in_best_chain !== 'boolean') {
      throw new Error('Esplora block status lacks an in_best_chain flag');
    }
    return status.in_best_chain;
  }

  private async getJson(path: string): Promise<unknown> {
    return json.parse(await this.getText(path));
  }

  private async getText(path: string): Promise<string> {
    const response = await this.request(path);
    if (!response.ok) {
      throw new Error(
        `Esplora request failed with HTTP ${response.status}`,
      );
    }
    return response.text();
  }

  private request(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }
}
