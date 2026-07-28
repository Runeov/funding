import {
  AbiCoder,
  ZeroAddress,
  concat,
  getAddress,
  keccak256,
  MaxUint256,
  parseEther,
} from 'ethers';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bytes32Pattern = /^0x[0-9a-fA-F]{64}$/;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;

export async function validateReleaseConfiguration() {
  const release = JSON.parse(
    await readFile(join(projectRoot, 'config', 'release.json'), 'utf8'),
  );
  const collection = JSON.parse(
    await readFile(join(projectRoot, 'config', 'collection.json'), 'utf8'),
  );
  const failures = [];

  if (typeof release.chain !== 'string' || release.chain.trim().length === 0) {
    failures.push('choose the target chain');
  }
  if (
    !Number.isSafeInteger(release.chainId) ||
    release.chainId < 1
  ) {
    failures.push('set a positive numeric chainId');
  }
  if (
    typeof release.nativeCurrencySymbol !== 'string' ||
    !/^[A-Z0-9]{2,10}$/.test(release.nativeCurrencySymbol)
  ) {
    failures.push('set nativeCurrencySymbol to the target chain ticker');
  }
  if (!isHttpsUrl(release.blockExplorerUrl)) {
    failures.push('set blockExplorerUrl to the target chain HTTPS explorer');
  }
  if (release.evmVersion !== 'cancun') {
    failures.push('confirm that the selected chain supports the Cancun EVM target');
  }

  const mintPriceMatch =
    typeof release.mintPriceNative === 'string'
      ? release.mintPriceNative.match(/^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/)
      : null;
  let validMintPrice = false;
  if (mintPriceMatch) {
    try {
      const mintPriceWei = parseEther(release.mintPriceNative);
      validMintPrice = mintPriceWei > 0n && mintPriceWei <= MaxUint256;
    } catch {
      validMintPrice = false;
    }
  }
  if (!validMintPrice) {
    failures.push(
      'set mintPriceNative as a positive decimal string with at most 18 decimals',
    );
  }
  if (
    !Number.isSafeInteger(release.maxPerWallet) ||
    release.maxPerWallet < 1 ||
    release.maxPerWallet > 150
  ) {
    failures.push('set maxPerWallet to an integer from 1 to 150');
  }
  if (!['allowlist', 'public'].includes(release.saleMode)) {
    failures.push('choose saleMode as either "allowlist" or "public"');
  }
  if (
    !Number.isSafeInteger(release.secondaryRoyaltyBps) ||
    release.secondaryRoyaltyBps < 0 ||
    release.secondaryRoyaltyBps > 1_000
  ) {
    failures.push('set secondaryRoyaltyBps to an integer from 0 to 1000');
  }

  for (const field of ['ownerMultisig', 'treasuryMultisig']) {
    try {
      if (getAddress(release[field]) === ZeroAddress) {
        failures.push(`${field} cannot be the zero address`);
      }
    } catch {
      failures.push(`set a valid ${field}`);
    }
  }

  for (const [label, uri] of [
    ['unrevealedMetadataUri', release.unrevealedMetadataUri],
    ['tokenMetadataBaseUri', release.tokenMetadataBaseUri],
    ['collectionMetadataUri', release.collectionMetadataUri],
    ['imageUri', collection.imageUri],
    ['utilityPolicyUri', collection.utilityPolicyUri],
  ]) {
    if (!isFinalIpfsUri(uri)) {
      failures.push(`pin and set the final ${label}`);
    }
  }
  if (
    isFinalIpfsUri(release.tokenMetadataBaseUri) &&
    !release.tokenMetadataBaseUri.endsWith('/')
  ) {
    failures.push('tokenMetadataBaseUri must end with "/" for token ID paths');
  }
  if (!isHttpsUrl(collection.externalUrl) || isPlaceholderHost(collection.externalUrl)) {
    failures.push('replace the placeholder externalUrl with the final HTTPS site URL');
  }

  if (
    collection.name !== 'KJ Genesis Funder Key' ||
    collection.symbol !== 'KJFG' ||
    collection.supply !== 150
  ) {
    failures.push('collection identity must match the immutable contract: KJ Genesis Funder Key / KJFG / 150');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(collection.artworkSha256 ?? '')) {
    failures.push('set artworkSha256 to the verified 32-byte artwork digest');
  }

  if (release.saleMode === 'allowlist') {
    await validateProductionAllowlist(release, failures);
  }

  if (release.legalReviewApproved !== true) {
    failures.push('obtain documented legal approval');
  }
  if (release.contractAuditApproved !== true) {
    failures.push('obtain an independent contract audit');
  }
  if (
    !transactionHashPattern.test(release.testnetRehearsalTransaction ?? '') ||
    /^0x0{64}$/i.test(release.testnetRehearsalTransaction ?? '')
  ) {
    failures.push('record the successful testnet rehearsal transaction hash');
  }

  return { release, collection, failures };
}

export function formatReleaseFailures(failures) {
  return failures.map((failure) => `- ${failure}`).join('\n');
}

async function validateProductionAllowlist(release, failures) {
  if (
    !bytes32Pattern.test(release.allowlistRoot ?? '') ||
    /^0x0{64}$/i.test(release.allowlistRoot ?? '')
  ) {
    failures.push('set allowlistRoot to the final non-zero generated root');
    return;
  }

  let generated;
  try {
    generated = JSON.parse(
      await readFile(join(projectRoot, 'allowlist', 'generated.json'), 'utf8'),
    );
  } catch {
    failures.push(
      'generate the final production allowlist at allowlist/generated.json',
    );
    return;
  }

  if (!bytes32Pattern.test(generated.root ?? '')) {
    failures.push('generated allowlist root is malformed');
    return;
  }
  if (generated.root.toLowerCase() !== release.allowlistRoot.toLowerCase()) {
    failures.push('release allowlistRoot does not match the generated allowlist');
  }
  if (!Array.isArray(generated.entries) || generated.entries.length === 0) {
    failures.push('generated production allowlist has no entries');
    return;
  }

  const abiCoder = AbiCoder.defaultAbiCoder();
  const seen = new Set();
  let totalAllocation = 0;

  for (const [index, entry] of generated.entries.entries()) {
    let address;
    try {
      address = getAddress(entry.address);
    } catch {
      failures.push(`allowlist entry ${index + 1} has an invalid address`);
      continue;
    }

    const normalizedAddress = address.toLowerCase();
    if (seen.has(normalizedAddress)) {
      failures.push(`allowlist contains duplicate address ${address}`);
    }
    seen.add(normalizedAddress);

    if (
      BigInt(normalizedAddress) <= 10n ||
      /\b(replace|placeholder|example)\b/i.test(String(entry.label ?? ''))
    ) {
      failures.push(
        'replace reserved or example wallet addresses in the production allowlist',
      );
    }

    if (
      !Number.isSafeInteger(entry.allocation) ||
      entry.allocation < 1 ||
      entry.allocation > release.maxPerWallet
    ) {
      failures.push(
        `allowlist allocation for ${address} must be from 1 to maxPerWallet (${release.maxPerWallet})`,
      );
      continue;
    }
    totalAllocation += entry.allocation;

    if (
      !Array.isArray(entry.proof) ||
      !entry.proof.every((value) => bytes32Pattern.test(value))
    ) {
      failures.push(`allowlist proof for ${address} is malformed`);
      continue;
    }

    let computed = keccak256(
      keccak256(
        abiCoder.encode(
          ['address', 'uint256'],
          [address, entry.allocation],
        ),
      ),
    );
    for (const sibling of entry.proof) {
      computed = hashPair(computed, sibling);
    }
    if (computed.toLowerCase() !== generated.root.toLowerCase()) {
      failures.push(`allowlist proof for ${address} does not reach the root`);
    }
  }

  if (
    totalAllocation !== generated.totalAllocation ||
    totalAllocation > 150
  ) {
    failures.push('generated allowlist total allocation is invalid');
  }
}

function isFinalIpfsUri(uri) {
  return (
    typeof uri === 'string' &&
    uri.startsWith('ipfs://') &&
    !/\s/.test(uri) &&
    !/replace|placeholder|example/i.test(uri)
  );
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isPlaceholderHost(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === 'example.com' ||
      hostname.endsWith('.example') ||
      hostname.endsWith('.invalid') ||
      hostname.endsWith('.test')
    );
  } catch {
    return true;
  }
}

function hashPair(left, right) {
  const [first, second] =
    BigInt(left) < BigInt(right) ? [left, right] : [right, left];
  return keccak256(concat([first, second]));
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const { failures } = await validateReleaseConfiguration();
  if (failures.length > 0) {
    console.error('Release is intentionally blocked:');
    console.error(formatReleaseFailures(failures));
    process.exitCode = 1;
  } else {
    console.log('Release configuration passes all launch gates.');
  }
}
