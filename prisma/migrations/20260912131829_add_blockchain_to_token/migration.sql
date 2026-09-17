-- CreateEnum
CREATE TYPE "Blockchain" AS ENUM ('EVM', 'BITCOIN');

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "blockchain" "Blockchain" NOT NULL DEFAULT 'EVM',
ALTER COLUMN "contractAddress" DROP NOT NULL;
