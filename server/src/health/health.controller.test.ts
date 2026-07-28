import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller';

describe('wallet-service health', () => {
  it('reports provider degradation without making an external request', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const config = {
      accounts: [{ chain: 'BITCOIN' }],
      paymentMonitor: { enabled: true },
    };
    const providerReadiness = {
      enabled: true,
      ready: false,
      chains: [
        {
          chain: 'bitcoin',
          state: 'degraded',
          lastCheckedAt: '2026-07-28T12:00:00.000Z',
          lastSuccessAt: null,
          lastFailureAt: '2026-07-28T12:00:00.000Z',
        },
      ],
    };
    const paymentsMonitor = {
      getProviderReadiness: vi.fn().mockReturnValue(providerReadiness),
    };
    const controller = new HealthController(
      prisma as never,
      config as never,
      paymentsMonitor as never,
    );

    await expect(controller.getHealth()).resolves.toEqual({
      status: 'degraded',
      mode: 'watch-only',
      configuredChains: ['bitcoin'],
      monitoring: true,
      providerReadiness,
    });
    expect(paymentsMonitor.getProviderReadiness).toHaveBeenCalledOnce();
  });
});
