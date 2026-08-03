/*
  Warnings:

  - A unique constraint covering the columns `[transactionHash,logIndex]` on the table `TokenTransfer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `logIndex` to the `TokenTransfer` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "TokenTransfer_transactionHash_key";

-- AlterTable
ALTER TABLE "TokenTransfer" ADD COLUMN     "logIndex" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TokenTransfer_transactionHash_logIndex_key" ON "TokenTransfer"("transactionHash", "logIndex");
