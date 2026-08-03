-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT;
