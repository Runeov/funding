import {
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  getAddress,
  isAddress,
  parseEther,
} from 'ethers';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const release = JSON.parse(
  await readFile(join(projectRoot, 'config', 'release.json'), 'utf8'),
);
const collection = JSON.parse(
  await readFile(join(projectRoot, 'config', 'collection.json'), 'utf8'),
);
const artifact = JSON.parse(
  await readFile(
    join(
      projectRoot,
      'out',
      'KJGenesisFunderKey.sol',
      'KJGenesisFunderKey.json',
    ),
    'utf8',
  ),
);
const artworkHash = `0x${collection.artworkSha256}`;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function requiredAddress(name, value) {
  if (!isAddress(value) || value === ZeroAddress) {
    throw new Error(`${name} must be a non-zero EVM address.`);
  }
  return getAddress(value);
}

const rpcUrl = requiredEnvironment('KJ_NFT_RPC_URL');
const deployerPrivateKey = requiredEnvironment(
  'KJ_NFT_DEPLOYER_PRIVATE_KEY',
);
const owner = requiredAddress('ownerMultisig', release.ownerMultisig);
const treasury = requiredAddress('treasuryMultisig', release.treasuryMultisig);
const mintPriceNative = release.mintPriceNative;
const mintPrice = parseEther(mintPriceNative);
const maxPerWallet = BigInt(release.maxPerWallet);
const secondaryRoyaltyBps = BigInt(release.secondaryRoyaltyBps);
const unrevealedURI = release.unrevealedMetadataUri;
const contractURI = release.collectionMetadataUri;

if (mintPrice <= 0n) {
  throw new Error('release.mintPriceNative must be greater than zero.');
}
if (maxPerWallet < 1n || maxPerWallet > 150n) {
  throw new Error('release.maxPerWallet must be between 1 and 150.');
}
if (secondaryRoyaltyBps < 0n || secondaryRoyaltyBps > 1_000n) {
  throw new Error(
    'release.secondaryRoyaltyBps must be between 0 and 1000.',
  );
}
if (
  release.evmVersion !== 'cancun' ||
  release.legalReviewApproved !== true ||
  release.contractAuditApproved !== true ||
  !release.testnetRehearsalTransaction
) {
  throw new Error(
    'Release approvals, Cancun support, and testnet rehearsal must be recorded before deployment.',
  );
}
if (
  !unrevealedURI.startsWith('ipfs://') ||
  !contractURI.startsWith('ipfs://') ||
  unrevealedURI.includes('REPLACE') ||
  contractURI.includes('REPLACE')
) {
  throw new Error(
    'Deployment metadata must use final, non-placeholder IPFS URIs.',
  );
}

const provider = new JsonRpcProvider(rpcUrl);
const deployer = new Wallet(deployerPrivateKey, provider);
const network = await provider.getNetwork();
const expectedChainId = BigInt(release.chainId);
if (network.chainId !== expectedChainId) {
  throw new Error(
    `RPC chain ID ${network.chainId} does not match approved release chain ID ${expectedChainId}.`,
  );
}

console.log(`Network: ${release.chain} (${network.chainId})`);
console.log(`Deployer: ${deployer.address}`);
console.log(`Owner multisig: ${owner}`);
console.log(`Treasury multisig: ${treasury}`);
console.log(`Mint price: ${mintPriceNative} native token`);
console.log(`Max per wallet: ${maxPerWallet}`);
console.log(`Secondary royalty: ${secondaryRoyaltyBps} bps`);

const bytecode = artifact.bytecode?.object;
if (typeof bytecode !== 'string' || bytecode.length === 0) {
  throw new Error('Foundry artifact does not contain deployable bytecode.');
}

const factory = new ContractFactory(
  artifact.abi,
  `0x${bytecode.replace(/^0x/, '')}`,
  deployer,
);
const contract = await factory.deploy(
  owner,
  treasury,
  mintPrice,
  maxPerWallet,
  secondaryRoyaltyBps,
  unrevealedURI,
  contractURI,
  artworkHash,
);
const deploymentTransaction = contract.deploymentTransaction();
if (!deploymentTransaction) {
  throw new Error('Deployment transaction is unavailable.');
}
const receipt = await deploymentTransaction.wait();
if (!receipt) throw new Error('Deployment receipt is unavailable.');

const deployment = {
  contract: 'KJGenesisFunderKey',
  address: await contract.getAddress(),
  chainId: network.chainId.toString(),
  networkName: release.chain,
  transactionHash: receipt.hash,
  blockNumber: receipt.blockNumber,
  deployer: deployer.address,
  constructorArguments: {
    owner,
    treasury,
    mintPrice: mintPrice.toString(),
    maxPerWallet: maxPerWallet.toString(),
    secondaryRoyaltyBps: secondaryRoyaltyBps.toString(),
    unrevealedURI,
    contractURI,
    artworkHash,
  },
};

const deploymentsDirectory = join(projectRoot, 'deployments');
await mkdir(deploymentsDirectory, { recursive: true });
const outputPath = join(
  deploymentsDirectory,
  `deployment-${network.chainId}-${Date.now()}.json`,
);
await writeFile(
  outputPath,
  `${JSON.stringify(deployment, null, 2)}\n`,
);

const publicMintConfig = {
  enabled: true,
  chainId: Number(network.chainId),
  chainName: release.chain,
  currencySymbol: release.nativeCurrencySymbol,
  contractAddress: deployment.address,
  mintPriceWei: mintPrice.toString(),
  blockExplorerUrl: release.blockExplorerUrl.replace(/\/+$/, ''),
  allowlistUrl: 'nft/allowlist/generated.json',
};
const publicMintConfigPath = join(projectRoot, 'mint-config.js');
await writeFile(
  publicMintConfigPath,
  [
    '/* Generated by scripts/deploy.mjs from a release-gated deployment. */',
    `window.KJ_MINT_CONFIG = Object.freeze(${JSON.stringify(
      publicMintConfig,
      null,
      2,
    )});`,
    '',
  ].join('\n'),
);

console.log(`Deployed to ${deployment.address}`);
console.log(`Saved deployment record to ${outputPath}`);
console.log(`Updated public mint config at ${publicMintConfigPath}`);
