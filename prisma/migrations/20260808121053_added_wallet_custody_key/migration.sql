-- CreateTable
CREATE TABLE "WalletCustodyKey" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "encryptedKey" BYTEA NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "WalletCustodyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletCustodyKey_walletId_key" ON "WalletCustodyKey"("walletId");

-- CreateIndex
CREATE INDEX "WalletCustodyKey_walletId_idx" ON "WalletCustodyKey"("walletId");

-- AddForeignKey
ALTER TABLE "WalletCustodyKey" ADD CONSTRAINT "WalletCustodyKey_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
