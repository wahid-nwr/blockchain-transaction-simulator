/*
  Warnings:

  - A unique constraint covering the columns `[transactionId]` on the table `IdempotencyKey` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,key]` on the table `IdempotencyKey` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `key` to the `IdempotencyKey` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "IdempotencyKey" ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "transactionId" TEXT,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_transactionId_key" ON "IdempotencyKey"("transactionId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_tenantId_expiresAt_idx" ON "IdempotencyKey"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_tenantId_key_key" ON "IdempotencyKey"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
