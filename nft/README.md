# KJ Genesis Funder Key

The first Project KJ collection is a fixed edition of exactly **150** ERC-721
founder access keys. The mint is intended to raise **$15,000 gross** for the
Project KJ proof-of-concept pilot while giving each token a verifiable
ecosystem-eligibility role.

This folder is deliberately separate from the Bitcoin/Dogecoin watch-only
wallet service. The contract targets a Cancun-compatible EVM; no production
chain has been selected or deployed yet.

## Staged funding plan

Each stage must reach its operating milestone before the next stage opens:

| Stage | Target | Purpose | Gate |
|---|---:|---|---|
| 1 — Proof | $15,000 | Run the proof-of-concept pilot | 150 keys at a $100 target price |
| 2 — Udon Thani | $62,000 | Fund the planned province-wide expansion | Pilot results demonstrate the concept works |
| 3 — Bangkok launch | Up to $240,000 | Prepare the regulated token launch and Bangkok rollout | Udon Thani expansion milestones and required legal approvals |

The Genesis collection funds Stage 1 only. Stages 2 and 3 are separate,
conditional raises and do not increase this collection's 150-token supply.
The final on-chain mint price remains unset until a chain and payment asset are
selected; a volatile native asset cannot guarantee an exact USD receipt.

The example `$100 / $240,000 = 0.0417%` describes a fraction of a later
financing round only if a separate executed investment instrument grants it.
The NFT itself does not create company ownership.

## What exists now

- corrected square master art in
  `assets/kj-genesis-funder-key-master.png`;
- SHA-256 art provenance committed into contract configuration;
- 150 numbered metadata files (`#001` through `#150`);
- an immutable on-chain maximum supply of 150;
- exact-price allowlist and public mint phases;
- an owner allocation path for signed founder agreements;
- one configurable mint allowance per wallet;
- an immutable treasury destination;
- emergency pause and two-step ownership transfer;
- revealable IPFS metadata that can be permanently frozen;
- optional ERC-2981 secondary-sale royalty signalling;
- ownership check (`isFunder`) for marketplace entitlement services;
- a browser-wallet checkout that verifies contract code, chain, price, supply,
  sale phase, pause state, wallet allowance, and allowlist proofs before
  enabling a transaction;
- a fail-closed public mint configuration that remains disabled until the
  release-gated deployment script writes the verified contract details;
- deterministic double-hashed, sorted-pair allowlist generation compatible
  with the OpenZeppelin Solidity verifier; and
- contract tests covering the supply cap, sale controls, metadata freeze,
  pause behavior, and treasury routing.

The contract does **not** calculate or distribute yield or the proposed future
5% founder pool. ERC-2981 is a secondary-sale royalty signal and is not a
mechanism for sharing Merchant Box or node-upgrade receipts with holders.

## Local verification

```powershell
npm install
npm run metadata:generate
npm run check
```

The normal `check` command verifies an example allowlist in
`allowlist/example.generated.json`. It never writes
`allowlist/generated.json`, so a reviewed production founder list cannot be
silently replaced by the example wallet during a routine test run.

Generate a real allowlist after replacing the example wallet:

```powershell
npm run allowlist:generate -- config/allowlist.json allowlist/generated.json
npm run allowlist:check -- allowlist/generated.json
```

For an allowlist launch, set `saleMode` to `allowlist` and copy the generated
root into `allowlistRoot` in the reviewed release configuration. For a public
launch, set `saleMode` to `public`; a production allowlist is not required.
The release checker rejects the example wallet, mismatched roots, malformed
proofs, and allocations above `maxPerWallet`.

The generated root is supplied to `setAllowlistRoot` after deployment. Keep the
complete input, sorted tree, and proof file as controlled launch records.
Human-readable labels from the private input are intentionally omitted from the
browser proof file. Wallet addresses in that static file are still public; use
an authenticated per-wallet proof service instead if the final buyer list must
remain private.

## Metadata model

All 150 tokens use one coherent master artwork and receive an immutable edition
number. The internal Project KJ wallet may display progressive milestone states,
but it should calculate those states from the published utility policy and
network milestones—not silently mutate frozen on-chain history.

The current metadata contains only stable eligibility traits. The detailed
commercial mechanics live in `config/funder-utility-policy.json`, where they can
be reviewed before becoming binding program terms.

Before IPFS upload:

1. Replace every `REPLACE_WITH_*` value in `config/collection.json`.
2. Replace the `.example` external URL.
3. Pin the master image and policy with at least two independent pinning
   arrangements.
4. Regenerate all metadata.
5. Pin the complete `metadata/tokens` directory without renaming files.
6. Put the resulting directory URI into `config/release.json`.

`npm run release:check` intentionally fails until every launch gate is complete.
It also requires a positive chain ID, an 18-decimal-compatible mint price, final
IPFS paths, the selected sale mode, a correctly shaped testnet transaction
hash, and—when applicable—the verified production allowlist root.

## Required business decisions

No mainnet deployment should occur until these are recorded:

1. **Chain:** Base, Polygon, Ethereum, or another audited EVM network, with
   Cancun opcode support explicitly confirmed.
2. **Network display:** native currency ticker and official HTTPS block
   explorer used by the public wallet.
3. **Mint price and currency:** fixed native-token price or a separate
   stablecoin mint design.
4. **Sale policy:** allowlist only, public phase, per-wallet cap, and any
   reserved allocations.
5. **Administration:** 2-of-3 multisig addresses for owner and treasury.
6. **Proceeds:** a written pilot budget and public use-of-funds statement.
7. **Benefits:** snapshot timing, transfer treatment, claim consumption,
   exclusions, taxes, geographic availability, and failure/refund treatment.
8. **Revenue pool:** gross versus net basis, payment assets, payout cadence,
   custody, unclaimed funds, sanctions/KYC, and termination rules.

The draft policy uses these mechanics:

- multiplier and zero-fee eligibility require current ownership;
- Merchant Box and hardware claims are consumed once per token ID;
- transfer after a one-time claim does not recreate that claim; and
- any future founder pool would use explicit epochs and per-token snapshots.

## Deployment safety

The collection is a fundraising instrument with proposed revenue participation.
Do not market or sell it as a normal collectible until qualified counsel has
classified the offering and approved its disclosures in every intended buyer
jurisdiction. Keep terms such as “yield,” “royalty,” and “guaranteed” out of
public artwork and sales copy until that review is complete.

After legal approval and an independent contract audit:

1. deploy to the chosen testnet;
2. rehearse allowlist mint, reveal, metadata freeze, transfer, pause, and
   treasury withdrawal;
3. record the testnet transaction in `config/release.json`;
4. run `npm run release:check`;
5. export the RPC and single-purpose deployer variables from `.env.example`;
   all constructor settings come from the reviewed release file; and
6. run `npm run deploy:target`.

The deployment script repeats the release validation internally, so invoking
the underlying Node script directly cannot bypass the launch gates. It also
checks that the owner and treasury addresses contain multisig contract code on
the selected chain before broadcasting. The supported `deploy:target` command
also reruns the complete metadata, allowlist-tooling, wallet-selector, build,
format, and contract-test suite before any broadcast.

The deployment script writes `mint-config.js` only after all release checks
pass and deployment is confirmed. The website then reads live contract state
through the buyer's explicitly connected EVM wallet. The contract still starts
with its sale closed; the multisig owner must publish the reviewed allowlist
root, if used, and deliberately open the selected sale phase. Verify the
contract source on the selected explorer and compare its constructor arguments
with the saved deployment record before opening that phase.

Never commit a deployer private key. The production owner and treasury should be
multisigs, not the deployer wallet.

## Artwork generation record

The built-in image-generation workflow produced the master from the existing
`public/images/FundersKey.png` visual world. The final prompt preserved the KJ
gold-lock, Bangkok cyber-street, cyan-circuit, and dark-vault identity while
removing all benefit panels, wallet data, multiplier claims, and promotional
copy. Only the engraved `KJ` mark remains in the artwork. Exact collection and
edition text lives in metadata.
