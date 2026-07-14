-- CreateTable
CREATE TABLE "TokenTransfer" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenTransfer_transactionHash_key" ON "TokenTransfer"("transactionHash");

-- CreateIndex
CREATE INDEX "TokenTransfer_from_idx" ON "TokenTransfer"("from");

-- CreateIndex
CREATE INDEX "TokenTransfer_to_idx" ON "TokenTransfer"("to");

-- AddForeignKey
ALTER TABLE "TokenTransfer" ADD CONSTRAINT "TokenTransfer_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
