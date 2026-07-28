import { AddressType, Chain, ChainNetwork } from '@prisma/client';
import { BIP32Factory } from 'bip32';
import { networks } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';
import { deriveAddress, validateAccountXpub } from './derive';
import type { AccountWalletConfig } from './types';

const fixtureFingerprint = '3442193e';
const bitcoinAccountXpub =
  'xpub6CDEarkRoiwWPj3n3gYygGwgoGchxYg3g6Zs5L2nB4B6wdojzcWCKKHMu9XuY1GyYygRfrVembjAko1T5xTsxj7ecKXxEPzDxx7nCK8Dxtx';
const dogecoinAccountXpub =
  'dgub8rRgxK5Zh4vYtZ1Yvqn6KwaL41mvAKWCv63Kihbtu6NjyGdkFdumsFosc97Wvon148BUCfospeL3RWHBpJfyPBt2P2KU97o2PVvh5wNNuCf';

const bitcoinConfig: AccountWalletConfig = {
  keyRef: 'bitcoin-test-vector',
  accountXpub: bitcoinAccountXpub,
  accountPath: "m/44'/0'/0'",
  masterFingerprint: fixtureFingerprint,
  chain: Chain.BITCOIN,
  network: ChainNetwork.MAINNET,
  addressType: AddressType.P2PKH,
};

const dogecoinConfig: AccountWalletConfig = {
  keyRef: 'dogecoin-test-vector',
  accountXpub: dogecoinAccountXpub,
  accountPath: "m/44'/3'/0'",
  masterFingerprint: fixtureFingerprint,
  chain: Chain.DOGECOIN,
  network: ChainNetwork.MAINNET,
  addressType: AddressType.P2PKH,
};

describe('watch-only account derivation', () => {
  it.each([
    {
      config: bitcoinConfig,
      index: 0,
      address: '1NQpH6Nf8QtR2HphLRcvuVqfhXBXsiWn8r',
      publicKey:
        '0239b4b3a27cd1dd8993038d5eb6449220b350c32ae62fec0833b93db8a49031c5',
    },
    {
      config: bitcoinConfig,
      index: 381,
      address: '12G73sJ7Jh761YKht4vEPGLSghwyxy3Sb7',
      publicKey:
        '02de6115e4a693431d06f36544a3dd5c92504385a7c161695dd2decd2db13178ba',
    },
    {
      config: dogecoinConfig,
      index: 0,
      address: 'DNSR56PerBCVZr9L188zTKZ2unzezm7Ddm',
      publicKey:
        '02bd430161b3c3dcc984e411cac60cc7f3a83f352febb9a76aaab6acb1fe255f21',
    },
    {
      config: dogecoinConfig,
      index: 381,
      address: 'D6EapuEo59xxbYMBWRiAG76RL6DaybzGwN',
      publicKey:
        '0253299a9ec6d6b2451e98c8ba77b00ac9f98cf611a4451ff013e0561a276209e4',
    },
  ])(
    'derives $config.chain index $index from the account XPUB',
    ({ config, index, address, publicKey }) => {
      const derived = deriveAddress(config, index);
      expect(derived).toMatchObject({
        address,
        publicKeyHex: publicKey,
        relativePath: `0/${index}`,
        derivationPath: `${config.accountPath}/0/${index}`,
        index,
      });
    },
  );

  it('rejects extended private keys', () => {
    const bip32 = BIP32Factory(ecc);
    const accountXprv = bip32
      .fromSeed(
        Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'),
        networks.bitcoin,
      )
      .derivePath("m/44'/0'/0'")
      .toBase58();

    expect(() =>
      validateAccountXpub({
        ...bitcoinConfig,
        accountXpub: accountXprv,
      }),
    ).toThrow(/private keys are forbidden/i);
  });

  it.each([-1, 1.5, 0x80000000])(
    'rejects invalid non-hardened index %s',
    (index) => {
      expect(() => deriveAddress(bitcoinConfig, index)).toThrow(
        /address index/i,
      );
    },
  );

  it('rejects a chain/path coin-type mismatch', () => {
    expect(() =>
      validateAccountXpub({
        ...bitcoinConfig,
        accountPath: "m/44'/3'/0'",
      }),
    ).toThrow(/coin type 0/i);
  });

  it('rejects a Dogecoin key under Bitcoin serialization rules', () => {
    expect(() =>
      validateAccountXpub({
        ...bitcoinConfig,
        accountXpub: dogecoinAccountXpub,
      }),
    ).toThrow();
  });
});
