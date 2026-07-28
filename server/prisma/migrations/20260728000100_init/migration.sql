CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "Chain" AS ENUM ('BITCOIN', 'DOGECOIN');
CREATE TYPE "ChainNetwork" AS ENUM ('MAINNET');
CREATE TYPE "AddressType" AS ENUM ('P2PKH', 'P2WPKH');
CREATE TYPE "AddressPurpose" AS ENUM ('USER_RECEIVE', 'ORDER_DEPOSIT');
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'RESERVED', 'FULFILLED', 'CANCELLED', 'REVIEW');
CREATE TYPE "PaymentStatus" AS ENUM ('AWAITING', 'PARTIAL', 'CONFIRMING', 'PAID', 'EXPIRED', 'REORGED', 'CANCELLED', 'REVIEW');
CREATE TYPE "ChainTransactionStatus" AS ENUM ('UNKNOWN', 'MEMPOOL', 'CONFIRMED', 'ORPHANED', 'DROPPED', 'CONFLICTED');
CREATE TYPE "SettlementStatus" AS ENUM ('ACTIVE', 'REVERSED');

CREATE TABLE "User" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "externalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HdAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "keyRef" TEXT NOT NULL,
  "xpubHash" TEXT NOT NULL,
  "masterFingerprint" TEXT NOT NULL,
  "accountPath" TEXT NOT NULL,
  "chain" "Chain" NOT NULL,
  "network" "ChainNetwork" NOT NULL,
  "addressType" "AddressType" NOT NULL,
  "nextExternalIndex" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HdAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HdAccount_hash_metadata"
    CHECK ("xpubHash" ~ '^[0-9a-f]{64}$' AND "masterFingerprint" ~ '^[0-9a-f]{8}$')
);

CREATE TABLE "Wallet" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "hdAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DerivedAddress" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hdAccountId" UUID NOT NULL,
  "walletId" UUID,
  "chain" "Chain" NOT NULL,
  "network" "ChainNetwork" NOT NULL,
  "purpose" "AddressPurpose" NOT NULL,
  "branch" INTEGER NOT NULL DEFAULT 0,
  "derivationIndex" INTEGER NOT NULL,
  "derivationPath" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "publicKeyHex" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "DerivedAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DerivedAddress_valid_child_index"
    CHECK ("branch" IN (0, 1) AND "derivationIndex" BETWEEN 0 AND 2147483647),
  CONSTRAINT "DerivedAddress_public_key"
    CHECK ("publicKeyHex" ~ '^(02|03)[0-9a-f]{64}$')
);

CREATE TABLE "Order" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "externalOrderId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "itemRef" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentIntent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "depositAddressId" UUID NOT NULL,
  "expectedAtomic" BIGINT NOT NULL,
  "requiredConfirmations" INTEGER NOT NULL DEFAULT 3,
  "status" "PaymentStatus" NOT NULL DEFAULT 'AWAITING',
  "observedAtomic" BIGINT NOT NULL DEFAULT 0,
  "confirmedAtomic" BIGINT NOT NULL DEFAULT 0,
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "settlementEpoch" INTEGER NOT NULL DEFAULT 0,
  "lastEvaluatedTipHash" TEXT,
  "lastScannedAt" TIMESTAMP(3),
  "monitorUntil" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "reorgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentIntent_positive_payment"
    CHECK ("expectedAtomic" > 0 AND "requiredConfirmations" > 0)
);

CREATE TABLE "ChainCursor" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chain" "Chain" NOT NULL,
  "network" "ChainNetwork" NOT NULL,
  "tipHash" TEXT,
  "tipHeight" INTEGER,
  "leaseOwner" UUID,
  "leaseUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChainCursor_tip_pair"
    CHECK (
      ("tipHash" IS NULL AND "tipHeight" IS NULL) OR
      ("tipHash" IS NOT NULL AND "tipHeight" IS NOT NULL AND
       "tipHash" ~ '^[0-9a-f]{64}$' AND "tipHeight" >= 0)
    ),
  CONSTRAINT "ChainCursor_lease_pair"
    CHECK (
      ("leaseOwner" IS NULL AND "leaseUntil" IS NULL) OR
      ("leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    )
);

CREATE TABLE "ChainTransaction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chain" "Chain" NOT NULL,
  "network" "ChainNetwork" NOT NULL,
  "txid" TEXT NOT NULL,
  "status" "ChainTransactionStatus" NOT NULL,
  "currentBlockHash" TEXT,
  "currentBlockHeight" INTEGER,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChainTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChainTransaction_txid" CHECK ("txid" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ChainTransaction_block_pair"
    CHECK (
      ("status" = 'CONFIRMED' AND
       "currentBlockHash" IS NOT NULL AND "currentBlockHeight" IS NOT NULL AND
       "currentBlockHash" ~ '^[0-9a-f]{64}$' AND "currentBlockHeight" >= 0) OR
      ("status" <> 'CONFIRMED' AND "currentBlockHash" IS NULL AND "currentBlockHeight" IS NULL)
    )
);

CREATE TABLE "TxInclusion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transactionId" UUID NOT NULL,
  "blockHash" TEXT NOT NULL,
  "blockHeight" INTEGER NOT NULL,
  "canonical" BOOLEAN NOT NULL DEFAULT true,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "orphanedAt" TIMESTAMP(3),
  CONSTRAINT "TxInclusion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TxInclusion_block"
    CHECK ("blockHash" ~ '^[0-9a-f]{64}$' AND "blockHeight" >= 0)
);

CREATE TABLE "ObservedUtxo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transactionId" UUID NOT NULL,
  "vout" INTEGER NOT NULL,
  "addressId" UUID NOT NULL,
  "paymentIntentId" UUID,
  "amountAtomic" BIGINT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObservedUtxo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObservedUtxo_valid_output"
    CHECK ("vout" >= 0 AND "amountAtomic" >= 0)
);

CREATE TABLE "PaymentSettlement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "paymentIntentId" UUID NOT NULL,
  "epoch" INTEGER NOT NULL,
  "amountAtomic" BIGINT NOT NULL,
  "status" "SettlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "qualifiedTipHash" TEXT NOT NULL,
  "qualifiedAtHeight" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  "reversalTipHash" TEXT,
  CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentSettlement_values"
    CHECK ("epoch" > 0 AND "amountAtomic" > 0 AND "qualifiedAtHeight" >= 0)
);

CREATE TABLE "OutboxEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventKey" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" UUID,
  "leaseUntil" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboxEvent_lease_pair"
    CHECK (
      ("leaseToken" IS NULL AND "leaseUntil" IS NULL) OR
      ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");
CREATE UNIQUE INDEX "HdAccount_keyRef_key" ON "HdAccount"("keyRef");
CREATE UNIQUE INDEX "HdAccount_chain_network_keyRef_key" ON "HdAccount"("chain", "network", "keyRef");
CREATE UNIQUE INDEX "Wallet_userId_hdAccountId_key" ON "Wallet"("userId", "hdAccountId");
CREATE UNIQUE INDEX "DerivedAddress_hdAccountId_branch_derivationIndex_key"
  ON "DerivedAddress"("hdAccountId", "branch", "derivationIndex");
CREATE UNIQUE INDEX "DerivedAddress_chain_network_address_key"
  ON "DerivedAddress"("chain", "network", "address");
CREATE INDEX "DerivedAddress_walletId_purpose_idx" ON "DerivedAddress"("walletId", "purpose");
CREATE UNIQUE INDEX "Order_externalOrderId_key" ON "Order"("externalOrderId");
CREATE UNIQUE INDEX "PaymentIntent_orderId_key" ON "PaymentIntent"("orderId");
CREATE UNIQUE INDEX "PaymentIntent_depositAddressId_key" ON "PaymentIntent"("depositAddressId");
CREATE INDEX "PaymentIntent_status_expiresAt_idx" ON "PaymentIntent"("status", "expiresAt");
CREATE INDEX "PaymentIntent_monitorUntil_lastScannedAt_idx"
  ON "PaymentIntent"("monitorUntil", "lastScannedAt");
CREATE UNIQUE INDEX "ChainCursor_chain_network_key"
  ON "ChainCursor"("chain", "network");
CREATE INDEX "ChainCursor_leaseUntil_idx" ON "ChainCursor"("leaseUntil");
CREATE UNIQUE INDEX "ChainTransaction_chain_network_txid_key"
  ON "ChainTransaction"("chain", "network", "txid");
CREATE INDEX "ChainTransaction_status_lastSeenAt_idx" ON "ChainTransaction"("status", "lastSeenAt");
CREATE UNIQUE INDEX "TxInclusion_transactionId_blockHash_key"
  ON "TxInclusion"("transactionId", "blockHash");
CREATE INDEX "TxInclusion_canonical_blockHeight_idx" ON "TxInclusion"("canonical", "blockHeight");
CREATE UNIQUE INDEX "TxInclusion_one_canonical_per_transaction"
  ON "TxInclusion"("transactionId") WHERE "canonical" = true;
CREATE UNIQUE INDEX "ObservedUtxo_transactionId_vout_key" ON "ObservedUtxo"("transactionId", "vout");
CREATE INDEX "ObservedUtxo_paymentIntentId_idx" ON "ObservedUtxo"("paymentIntentId");
CREATE INDEX "ObservedUtxo_addressId_idx" ON "ObservedUtxo"("addressId");
CREATE UNIQUE INDEX "PaymentSettlement_paymentIntentId_epoch_key"
  ON "PaymentSettlement"("paymentIntentId", "epoch");
CREATE INDEX "PaymentSettlement_paymentIntentId_status_idx"
  ON "PaymentSettlement"("paymentIntentId", "status");
CREATE UNIQUE INDEX "PaymentSettlement_one_active_per_intent"
  ON "PaymentSettlement"("paymentIntentId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "OutboxEvent_eventKey_key" ON "OutboxEvent"("eventKey");
CREATE INDEX "OutboxEvent_publishedAt_nextAttemptAt_idx" ON "OutboxEvent"("publishedAt", "nextAttemptAt");
CREATE INDEX "OutboxEvent_leaseUntil_idx" ON "OutboxEvent"("leaseUntil");

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_hdAccountId_fkey"
  FOREIGN KEY ("hdAccountId") REFERENCES "HdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DerivedAddress" ADD CONSTRAINT "DerivedAddress_hdAccountId_fkey"
  FOREIGN KEY ("hdAccountId") REFERENCES "HdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DerivedAddress" ADD CONSTRAINT "DerivedAddress_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_depositAddressId_fkey"
  FOREIGN KEY ("depositAddressId") REFERENCES "DerivedAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TxInclusion" ADD CONSTRAINT "TxInclusion_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "ChainTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ObservedUtxo" ADD CONSTRAINT "ObservedUtxo_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "ChainTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ObservedUtxo" ADD CONSTRAINT "ObservedUtxo_addressId_fkey"
  FOREIGN KEY ("addressId") REFERENCES "DerivedAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ObservedUtxo" ADD CONSTRAINT "ObservedUtxo_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
