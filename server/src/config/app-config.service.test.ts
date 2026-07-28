import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigService } from './app-config.service';

const bitcoinXpub =
  'xpub6CDEarkRoiwWPj3n3gYygGwgoGchxYg3g6Zs5L2nB4B6wdojzcWCKKHMu9XuY1GyYygRfrVembjAko1T5xTsxj7ecKXxEPzDxx7nCK8Dxtx';

function setBaseEnvironment(): void {
  vi.stubEnv('INTERNAL_API_KEY', 'unit-test-internal-key-000000000000');
  vi.stubEnv('BITCOIN_ACCOUNT_KEY_REF', 'bitcoin-unit-vector');
  vi.stubEnv('BITCOIN_ACCOUNT_XPUB', bitcoinXpub);
  vi.stubEnv('BITCOIN_ACCOUNT_PATH', "m/44'/0'/0'");
  vi.stubEnv('BITCOIN_MASTER_FINGERPRINT', '3442193e');
  vi.stubEnv('PAYMENT_MONITOR_ENABLED', 'false');
  vi.stubEnv('DOGECOIN_ACCOUNT_XPUB', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AppConfigService', () => {
  it('loads a validated watch-only account without injected constructor args', () => {
    setBaseEnvironment();
    const config = new AppConfigService();
    expect(config.accounts).toHaveLength(1);
    expect(config.accounts[0]).toMatchObject({
      chain: 'BITCOIN',
      accountPath: "m/44'/0'/0'",
    });
  });

  it('requires monitoring for every enabled payment chain', () => {
    setBaseEnvironment();
    vi.stubEnv('PAYMENT_MONITOR_ENABLED', 'true');
    expect(() => new AppConfigService()).toThrow(/Esplora endpoint.*BITCOIN/i);
  });

  it('rejects plaintext non-loopback providers', () => {
    setBaseEnvironment();
    vi.stubEnv('BITCOIN_ESPLORA_URL', 'http://explorer.example/api');
    expect(() => new AppConfigService()).toThrow(/must use HTTPS/i);
  });

  it('allows loopback HTTP for local development', () => {
    setBaseEnvironment();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BITCOIN_ESPLORA_URL', 'http://127.0.0.1:3002/api');
    expect(new AppConfigService().providers[0].baseUrl).toBe(
      'http://127.0.0.1:3002/api',
    );
  });
});
