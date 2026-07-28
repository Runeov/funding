import { id } from 'ethers';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const page = await readFile(join(projectRoot, '..', 'src_index.html'), 'utf8');
const configSource = await readFile(join(projectRoot, 'mint-config.js'), 'utf8');

const requiredPageMarkers = [
  'id="v-wallet"',
  'id="walletConnect"',
  'id="walletMint"',
  'id="walletStatus"',
  'nft/mint-config.js',
  "body.classList.toggle('route-wallet'",
];
for (const marker of requiredPageMarkers) {
  if (!page.includes(marker)) {
    throw new Error(`Founder wallet page is missing required marker: ${marker}`);
  }
}

const selectorSignatures = {
  totalSupply: 'totalSupply()',
  remainingSupply: 'remainingSupply()',
  mintPrice: 'mintPrice()',
  maxPerWallet: 'maxPerWallet()',
  salePhase: 'salePhase()',
  mintedByWallet: 'mintedByWallet(address)',
  publicMint: 'publicMint(uint256)',
  allowlistMint: 'allowlistMint(uint256,uint256,bytes32[])',
  allowlistRoot: 'allowlistRoot()',
  paused: 'paused()',
};
for (const [name, signature] of Object.entries(selectorSignatures)) {
  const match = page.match(
    new RegExp(`\\b${name}\\s*:\\s*['"](0x[0-9a-fA-F]{8})['"]`),
  );
  if (!match) {
    throw new Error(`Founder wallet page is missing selector ${name}.`);
  }
  const expected = id(signature).slice(0, 10).toLowerCase();
  if (match[1].toLowerCase() !== expected) {
    throw new Error(
      `${name} selector ${match[1]} does not match ${signature} (${expected}).`,
    );
  }
}

const inlineScripts = [
  ...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
];
if (inlineScripts.length === 0) {
  throw new Error('No inline scripts found in src_index.html.');
}
for (const [, source] of inlineScripts) {
  Function(source);
}
Function(configSource);

const configSandbox = { window: {} };
runInNewContext(configSource, configSandbox, {
  filename: 'mint-config.js',
});
const defaultConfig = configSandbox.window.KJ_MINT_CONFIG;
if (
  !defaultConfig ||
  defaultConfig.enabled !== false ||
  defaultConfig.chainId !== null ||
  defaultConfig.contractAddress !== null ||
  defaultConfig.mintPriceWei !== null ||
  defaultConfig.blockExplorerUrl !== null
) {
  throw new Error(
    'Default public mint configuration must fail closed without chain, contract, price, or explorer values.',
  );
}
if (!Object.isFrozen(defaultConfig)) {
  throw new Error('Default public mint configuration must be immutable.');
}

console.log(
  `Founder wallet page verified (${inlineScripts.length} inline scripts parsed, ${Object.keys(selectorSignatures).length} selectors matched).`,
);
