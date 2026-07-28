'use strict';

require('reflect-metadata');
require('../dist/payments/esplora.provider.js');
const { NestFactory } = require('@nestjs/core');
const { AppConfigService } = require('../dist/config/app-config.service.js');
const { ConfigModule } = require('../dist/config/config.module.js');

process.env.INTERNAL_API_KEY = 'compiled-smoke-test-key-000000000000';
process.env.BITCOIN_ACCOUNT_KEY_REF = 'bitcoin-smoke-vector';
process.env.BITCOIN_ACCOUNT_XPUB =
  'xpub6CDEarkRoiwWPj3n3gYygGwgoGchxYg3g6Zs5L2nB4B6wdojzcWCKKHMu9XuY1GyYygRfrVembjAko1T5xTsxj7ecKXxEPzDxx7nCK8Dxtx';
process.env.BITCOIN_ACCOUNT_PATH = "m/44'/0'/0'";
process.env.BITCOIN_MASTER_FINGERPRINT = '3442193e';
process.env.PAYMENT_MONITOR_ENABLED = 'false';
delete process.env.DOGECOIN_ACCOUNT_XPUB;

async function smokeTest() {
  const dependencies =
    Reflect.getMetadata('design:paramtypes', AppConfigService) ?? [];
  if (dependencies.length !== 0) {
    throw new Error('AppConfigService unexpectedly requires Nest injection');
  }

  const context = await NestFactory.createApplicationContext(ConfigModule, {
    logger: false,
  });
  try {
    const config = context.get(AppConfigService);
    if (config.accounts.length !== 1 || config.accounts[0].chain !== 'BITCOIN') {
      throw new Error('Compiled config smoke test failed');
    }
  } finally {
    await context.close();
  }

  process.stdout.write('Compiled runtime and Nest DI smoke test passed.\n');
}

smokeTest().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
