import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'ethers';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const release = JSON.parse(
  await readFile(join(projectRoot, 'config', 'release.json'), 'utf8'),
);
const collection = JSON.parse(
  await readFile(join(projectRoot, 'config', 'collection.json'), 'utf8'),
);

const failures = [];

if (!release.chain || !Number.isSafeInteger(release.chainId)) {
  failures.push('choose the target chain and numeric chainId');
}
if (
  typeof release.nativeCurrencySymbol !== 'string' ||
  !/^[A-Z0-9]{2,10}$/.test(release.nativeCurrencySymbol)
) {
  failures.push('set nativeCurrencySymbol to the target chain ticker');
}
if (
  typeof release.blockExplorerUrl !== 'string' ||
  !/^https:\/\/[^/\s]+(?:\/.*)?$/.test(release.blockExplorerUrl)
) {
  failures.push('set blockExplorerUrl to the target chain HTTPS explorer');
}
if (release.evmVersion !== 'cancun') {
  failures.push('confirm that the selected chain supports the Cancun EVM target');
}
if (
  typeof release.mintPriceNative !== 'string' ||
  !/^(0|[1-9]\d*)(\.\d+)?$/.test(release.mintPriceNative) ||
  Number(release.mintPriceNative) <= 0
) {
  failures.push('set mintPriceNative as a positive decimal string');
}
if (
  !Number.isSafeInteger(release.maxPerWallet) ||
  release.maxPerWallet < 1 ||
  release.maxPerWallet > 150
) {
  failures.push('set maxPerWallet to an integer from 1 to 150');
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
    if (getAddress(release[field]) === '0x0000000000000000000000000000000000000000') {
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
  if (typeof uri !== 'string' || !uri.startsWith('ipfs://') || uri.includes('REPLACE')) {
    failures.push(`pin and set the final ${label}`);
  }
}
if (collection.externalUrl.includes('.example')) {
  failures.push('replace the placeholder externalUrl');
}
if (!release.legalReviewApproved) failures.push('obtain documented legal approval');
if (!release.contractAuditApproved) failures.push('obtain an independent contract audit');
if (!release.testnetRehearsalTransaction) {
  failures.push('record the successful testnet rehearsal transaction');
}

if (failures.length > 0) {
  console.error('Release is intentionally blocked:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Release configuration passes all launch gates.');
}
