-- AlterTable
ALTER TABLE "TokenEventCursor" ADD COLUMN     "lastProcessedLogIndex" BIGINT NOT NULL DEFAULT 0;
