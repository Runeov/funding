# Project KJ Wallet Service

A dedicated, watch-only service for deterministic Bitcoin and Dogecoin
addresses, per-order deposits, confirmation tracking, and reliable marketplace
notifications.

The service never accepts or stores a mnemonic, seed, XPRV, or individual
private key. Transaction and NFT signing belong in a separately isolated
signer/custody system.

## The corrected HD boundary

An XPUB cannot derive through hardened path components. Account keys must be
derived offline:

```text
Bitcoin:  m/44'/0'/0'  -> account XPUB -> server derives 0/index
Dogecoin: m/44'/3'/0'  -> account dgub -> server derives 0/index
```

Bitcoin and Dogecoin require separate account keys. Dogecoin uses coin type
`3`, Dogecoin extended-key versions, and legacy P2PKH (`D...`) addresses.

The server validates that every configured key:

- is public, never private;
- is at BIP32 depth 3;
- matches the account number declared by its path;
- uses the correct chain serialization and SLIP-44 coin type; and
- has an eight-hex-digit root fingerprint recorded as origin metadata.

The root fingerprint is metadata; it cannot be cryptographically verified from
an account XPUB alone.

## What is implemented

- NestJS internal REST API protected by a constant-time API-key check
- PostgreSQL/Prisma schema and deployment migration
- automatic wallet creation during idempotent user registration
- atomic, race-safe child-index allocation
- one immutable deposit address per order
- idempotent order creation with conflicting-retry detection
- Bitcoin/Dogecoin-compatible Esplora provider abstraction
- 20-second monitor interval (configurable)
- one database-backed monitor lease per chain, safe across service replicas
- coherent tip-before/tip-after batches with canonical-block verification
- HTTPS and expected-genesis verification for every chain provider
- provider readiness and last-success/failure timestamps on the health endpoint
- UTXO/outpoint-level payment records
- confirmations calculated from canonical block height
- reorg-aware settlement reversal and reconfirmation epochs
- transactional outbox events for NFT reservation consumers
- deterministic Bitcoin and Dogecoin derivation tests

The standalone `../src_index.html` marketing artifact is intentionally
unchanged and continues to make zero external calls.

## Setup

Requirements: Node.js 22+, PostgreSQL 16+, and account-level public keys created
in an offline environment.

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Fill in at least one account XPUB and its root fingerprint before starting.
Use a random `INTERNAL_API_KEY` with at least 32 characters.

Monitoring is opt-in. When `PAYMENT_MONITOR_ENABLED=false`, the process makes no
blockchain-provider calls and refuses to issue order deposit addresses. For
production, use a trusted HTTPS private/self-hosted Esplora instance; querying a
public explorer reveals the addresses being monitored. The configured endpoint
must return the expected chain genesis block or the scan fails closed.

Each tick leases one chain to one service replica, scans at most
`PAYMENT_MONITOR_BATCH_SIZE` least-recently-scanned intents, and applies nothing
unless the chain tip is unchanged across the full batch. Addresses remain under
watch through the configured retention period after expiry or settlement.
When monitoring is enabled, each leased provider is also checked against its
expected genesis and current canonical tip even while there are no open orders.
`GET /v1/health` reports `degraded` until every configured provider has passed a
check, without making provider calls in the health request itself.

## Internal API

Every endpoint except health requires:

```text
x-internal-api-key: <INTERNAL_API_KEY>
```

Register a marketplace user and automatically create configured wallets:

```http
POST /v1/users/register
Content-Type: application/json

{
  "externalUserId": "market-user-381",
  "chains": ["bitcoin", "dogecoin"]
}
```

Create an order-specific deposit address:

```http
POST /v1/payments/orders
Content-Type: application/json

{
  "externalOrderId": "order-2026-0001",
  "externalUserId": "market-user-381",
  "itemRef": "founder-nft-0001",
  "chain": "bitcoin",
  "expectedAmountAtomic": "125000",
  "requiredConfirmations": 3,
  "expiresAt": "2026-07-29T12:00:00.000Z"
}
```

Amounts are decimal strings in the chain's smallest unit. This avoids JSON
floating-point loss. The service enforces a minimum of three confirmations even
if a caller requests fewer. Retrying the same external order ID with identical
data is safe even after expiry; changing immutable data returns HTTP 409.
New-order expiry cannot be farther in the future than the configured retention
period. If `expiresAt` is omitted, the service derives a finite expiry one
retention period after creation and continues watching for one additional
retention period.

Read order/payment status:

```http
GET /v1/payments/orders/order-2026-0001
```

Consume marketplace events:

```http
POST /v1/events/outbox/claim?limit=100
POST /v1/events/outbox/{eventId}/ack

{
  "deliveryToken": "token-returned-by-claim"
}
```

Claims use a 60-second database lease and `FOR UPDATE SKIP LOCKED`, allowing
multiple consumers without assigning the same event concurrently.
`payment.confirmed` marks the wallet-service order as paid and tells the
marketplace to reserve the NFT. The wallet service does not claim the NFT is
reserved before the marketplace performs that action. Consumers must remain
idempotent by `eventKey` and `orderId`. `payment.reversed` releases an
unfulfilled reservation after a reorg. If fulfillment has already occurred,
the order remains in manual review. `payment.expired` closes an unpaid order.
`payment.review` is emitted instead when a monitoring window ends without a
clean terminal state, preventing an order from remaining silently awaiting.

## Payment safety model

Balances are not polled or credited directly. The monitor stores immutable
outpoints (`txid:vout`), their amounts, transaction state, and block inclusion
history. A payment becomes paid only when qualifying canonical outputs meet the
expected amount and confirmation threshold.

Confirmation counts are always recalculated:

```text
tip height - transaction block height + 1
```

A confirmed transaction that becomes explicitly unconfirmed or absent from the
provider while its former block is no longer canonical reverses its active
settlement. A single transaction-status 404 does not reverse payment by itself.
Malformed responses, network timeouts, provider chain mismatches, changed tips,
and expired monitor leases abort a scan and never cause a reversal.

The address-history strategy is intentionally bounded for Phase 1. For higher
volume, replace per-address history scans with a trusted node/indexer and
incremental block cursor before increasing the batch or retention limits.

## Explicitly out of scope

- seed or mnemonic generation in the online service
- private-key encryption or hot-wallet storage
- transaction signing
- NFT minting or transfer
- Ethereum, Polygon, Solana, Lightning, or Bitcoin Ordinals
- production legal/compliance approval for the Founder NFT concept

See [OFFLINE_KEY_CEREMONY.md](docs/OFFLINE_KEY_CEREMONY.md) before provisioning
real account keys.
