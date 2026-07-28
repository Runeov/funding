import type { Chain, ChainNetwork } from '@prisma/client';
import { networks, type Network } from 'bitcoinjs-lib';

// Dogecoin Core mainnet constants. Dogecoin does not define a standard
// Bech32 HRP, so this service exposes P2PKH only for Dogecoin.
export const dogecoinMainnet: Network = {
  messagePrefix: '\x19Dogecoin Signed Message:\n',
  bech32: '',
  bip32: {
    public: 0x02facafd,
    private: 0x02fac398,
  },
  pubKeyHash: 0x1e,
  scriptHash: 0x16,
  wif: 0x9e,
};

export function networkFor(
  chain: Chain,
  network: ChainNetwork,
): Network {
  if (network !== 'MAINNET') {
    throw new Error(`Unsupported network: ${network}`);
  }

  switch (chain) {
    case 'BITCOIN':
      return networks.bitcoin;
    case 'DOGECOIN':
      return dogecoinMainnet;
  }
}
