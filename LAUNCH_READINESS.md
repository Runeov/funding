# Project KJ launch readiness

This repository contains three separate launch surfaces:

- `src_index.html` and the two Ground demos: the public Project KJ site.
- `nft/`: the 150-supply KJ Genesis Funder Key contract, metadata, release gates, and browser-wallet checkout configuration.
- `server/`: an independent watch-only Bitcoin/Dogecoin wallet and payment-monitoring service.

## Current launch state

The public founder wallet is implemented, but the real mint is intentionally
disabled. It connects to an injected EVM wallet only after the visitor asks,
verifies the published chain, contract code, price, supply, sale phase, and
wallet allowance, and fails closed if any release value is missing or does not
match the contract.

Do not manually enable `nft/mint-config.js`. A successful release-gated
deployment writes that public configuration from verified deployment values.
The contract starts with the sale closed, so deployment alone cannot open the
mint.

## Decisions required before deployment

1. Obtain Thailand-specific legal classification and written approval for the
   final offer text and benefits. The proposed pooled revenue share and yield
   language can make this more than a simple collectible or access NFT.
2. Choose the EVM network, chain ID, native currency, and block explorer.
3. Decide whether the price is:
   - a fixed amount of the chain's native currency, which is what the current
     immutable contract supports; or
   - a true USD-denominated price, which requires a different payment design
     before audit and deployment.
4. Confirm the public or allowlist launch mode and replace the example wallet
   with the approved founder-wallet list.
5. Create separate owner and treasury multisigs. Never use a browser hot wallet
   or the deployer as the long-term owner or treasury.
6. Publish the artwork, collection metadata, token metadata, and utility policy
   to durable IPFS locations; replace every placeholder URI and the example
   external URL.
7. Complete an independent contract review/audit and a full testnet rehearsal.
8. Approve customer support, refund/error, tax/accounting, privacy, KYC/AML,
   incident-response, and treasury-reconciliation procedures.

The Thai SEC's current summary says a digital token can specify participation
in a project or rights to goods, services, or other benefits, and that public
offerings may require SEC approval, an effective filing/prospectus, and an
approved ICO Portal unless an exemption applies:

- https://www.sec.or.th/EN/Documents/ActandRoyalEnactment/Summary-of-EC-DA-2561-as-amended-en.pdf
- https://www.sec.or.th/EN/pages/lawandregulations/icoportal.aspx

These links are orientation only, not legal advice.

## Release sequence

1. Finish the decisions above.
2. Generate final metadata and the production allowlist without overwriting
   them with example data.
3. Fill every field in `nft/config/release.json`. Keep
   `legalReviewApproved`, `contractAuditApproved`, and the testnet rehearsal
   reference false or empty until evidence exists.
4. Run the full NFT verification:

   ```powershell
   npm.cmd --prefix .\nft run check
   npm.cmd --prefix .\nft run release:check
   ```

5. Set the deployment variables only in the secure deployment environment:

   ```text
   KJ_NFT_RPC_URL
   KJ_NFT_DEPLOYER_PRIVATE_KEY
   ```

6. Deploy through the gated command:

   ```powershell
   npm.cmd --prefix .\nft run deploy:target
   ```

7. Verify the contract source and constructor arguments on the selected block
   explorer. Confirm ownership and treasury addresses are the approved
   multisigs.
8. Test the production page with at least two wallet providers and a wallet
   that is not eligible. Verify rejection, wrong-network, sold-out, paused,
   closed-sale, allowlist, and successful-mint paths.
9. Have the owner multisig set the allowlist root if applicable, then explicitly
   change the sale phase. Recheck the public page before announcing the link.

## Website launch checks

- Serve all pages over HTTPS with HSTS, a restrictive host-level Content
  Security Policy, clickjacking protection, and a Permissions Policy.
- Set the production domain in NFT metadata and social-preview metadata.
- Confirm that local links and assets resolve from the final hosting base path.
- Check the landing, founder, wallet, model, systems, Ground Intelligence, and
  Restaurant Flow views at phone, tablet, laptop, and desktop widths.
- Connect error monitoring and uptime checks without sending wallet addresses
  to analytics.
- Publish a verified contract address and chain from one canonical Project KJ
  channel. Support must never ask for seed phrases, private keys, or recovery
  codes.

## Wallet service boundary

The service in `server/` is watch-only and is separate from the EVM NFT mint.
It must never receive a master seed, xprv, or private signing key. Before using
it for production Bitcoin/Dogecoin orders, provide production database and
Esplora infrastructure, private internal-API ingress, monitoring and alerts,
backups, a key ceremony, and end-to-end payment/reorg tests.

Run its local verification with:

```powershell
npm.cmd --prefix .\server run check
```

## Emergency stop

If a launch check fails after deployment:

1. Close the sale phase and pause the contract from the owner multisig.
2. Publish a short status message through the canonical Project KJ channel.
3. Keep transaction hashes, logs, and treasury records; do not redeploy or
   promise refunds until the incident is reconciled.
4. Restore the public checkout to its disabled release-gated configuration.
