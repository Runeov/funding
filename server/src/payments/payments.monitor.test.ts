import { Chain, ChainNetwork } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PaymentsMonitor } from './payments.monitor';

const bitcoinAccount = {
  chain: Chain.BITCOIN,
};
const bitcoinProvider = {
  chain: Chain.BITCOIN,
  network: ChainNetwork.MAINNET,
  baseUrl: 'https://esplora.example',
  genesisHash: '0'.repeat(64),
};

describe('PaymentsMonitor provider readiness', () => {
  it('reports configured chains as disabled when monitoring is off', () => {
    const monitor = new PaymentsMonitor(
      {} as never,
      {
        accounts: [bitcoinAccount],
        providers: [],
        paymentMonitor: { enabled: false },
      } as never,
      {} as never,
    );

    expect(monitor.getProviderReadiness()).toEqual({
      enabled: false,
      ready: true,
      chains: [
        {
          chain: 'bitcoin',
          state: 'disabled',
          lastCheckedAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        },
      ],
    });
  });

  it('stays pending until an enabled provider passes a real monitor check', () => {
    const monitor = new PaymentsMonitor(
      {} as never,
      {
        accounts: [bitcoinAccount],
        providers: [bitcoinProvider],
        paymentMonitor: { enabled: true },
      } as never,
      {} as never,
    );

    expect(monitor.getProviderReadiness()).toEqual({
      enabled: true,
      ready: false,
      chains: [
        {
          chain: 'bitcoin',
          state: 'pending',
          lastCheckedAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        },
      ],
    });
  });
});
