/*
 * Public mint configuration.
 *
 * This file intentionally fails closed until the audited contract is deployed.
 * `npm run deploy:target` replaces it with the verified deployment values after
 * every release gate in config/release.json has passed.
 */
window.KJ_MINT_CONFIG = Object.freeze({
  enabled: false,
  chainId: null,
  chainName: 'Launch network pending',
  currencySymbol: '',
  contractAddress: null,
  mintPriceWei: null,
  blockExplorerUrl: null,
  allowlistUrl: 'nft/allowlist/generated.json',
});
