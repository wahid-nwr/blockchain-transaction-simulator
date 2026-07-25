-- CreateTable
CREATE TABLE "TokenEventCursor" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "lastProcessedBlock" BIGINT NOT NULL DEFAULT 0,
    "lastSuccessfulSync" TIMESTAMP(3),
    "lastFailedSync" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenEventCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenEventCursor_tokenId_key" ON "TokenEventCursor"("tokenId");

-- AddForeignKey
ALTER TABLE "TokenEventCursor" ADD CONSTRAINT "TokenEventCursor_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
