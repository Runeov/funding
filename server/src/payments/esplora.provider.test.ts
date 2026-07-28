import { ChainTransactionStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EsploraProvider } from './esplora.provider';

const observedTxid = 'a'.repeat(64);
const tipHash = 'c'.repeat(64);
const address = 'deposit-address';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EsploraProvider', () => {
  it('parses atomic amounts without JavaScript number precision loss', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/address/${address}/txs/mempool`)) {
        return new Response(
          JSON.stringify([
            {
              txid: observedTxid,
              status: { confirmed: false },
              vout: [
                {
                  scriptpubkey_address: address,
                  value: 9_007_199_254_740_993n.toString(),
                },
              ],
            },
          ]).replace('"9007199254740993"', '9007199254740993'),
        );
      }
      if (url.endsWith(`/address/${address}/txs/chain`)) {
        return new Response('[]');
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EsploraProvider('https://esplora.example', 5_000, 2);
    const result = await provider.scanAddressAtTip(address, [], {
      hash: tipHash,
      height: 900_001,
    });

    expect(result.outputs).toEqual([
      {
        txid: observedTxid,
        vout: 0,
        amountAtomic: 9_007_199_254_740_993n,
      },
    ]);
    expect(result.transactions).toEqual([
      {
        txid: observedTxid,
        status: ChainTransactionStatus.MEMPOOL,
      },
    ]);
  });

  it('binds the reported height to the reported best-chain tip hash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/blocks/tip/hash')) {
          return new Response(tipHash);
        }
        if (url.endsWith(`/block/${tipHash}`)) {
          return new Response(
            JSON.stringify({ id: tipHash, height: 900_001 }),
          );
        }
        if (url.endsWith(`/block/${tipHash}/status`)) {
          return new Response(
            JSON.stringify({ in_best_chain: true }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const provider = new EsploraProvider('https://esplora.example', 5_000, 2);
    await expect(provider.getTip()).resolves.toEqual({
      hash: tipHash,
      height: 900_001,
    });
  });

  it('rejects a malformed transaction confirmation flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith(`/address/${address}/txs/mempool`)) {
          return new Response(
            JSON.stringify([
              {
                txid: observedTxid,
                status: {},
                vout: [],
              },
            ]),
          );
        }
        if (url.endsWith(`/address/${address}/txs/chain`)) {
          return new Response('[]');
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const provider = new EsploraProvider('https://esplora.example', 5_000, 2);
    await expect(
      provider.scanAddressAtTip(address, [], {
        hash: tipHash,
        height: 900_001,
      }),
    ).rejects.toThrow(/confirmed flag/i);
  });

  it('verifies the provider genesis hash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(observedTxid.toUpperCase())),
    );
    const provider = new EsploraProvider('https://esplora.example', 5_000, 2);
    await expect(provider.verifyNetwork(observedTxid)).resolves.toBeUndefined();
    await expect(provider.verifyNetwork(tipHash)).rejects.toThrow(
      /genesis mismatch/i,
    );
  });
});
