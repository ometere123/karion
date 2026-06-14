-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SYSTEM_WRAP_USED';

-- AlterEnum
ALTER TYPE "SuggestionStatus" ADD VALUE 'CREATED';

-- AlterEnum
ALTER TYPE "WrapMethod" ADD VALUE 'SYSTEM';

-- DropForeignKey
ALTER TABLE "admin_audit_logs" DROP CONSTRAINT "admin_audit_logs_userId_fkey";

-- DropIndex
DROP INDEX "sessions_token_key";

-- AlterTable
ALTER TABLE "admin_audit_logs" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "contract_events" ADD COLUMN     "userAddress" TEXT,
ADD COLUMN     "valueWei" TEXT;

-- AlterTable
ALTER TABLE "market_positions" ALTER COLUMN "amountGen" SET DEFAULT '0';

-- AlterTable
ALTER TABLE "market_suggestions" ADD COLUMN     "resolutionUrl" TEXT;

-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "creatorAddress" TEXT,
ADD COLUMN     "invalidCondition" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "noCondition" TEXT,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolutionQuery" TEXT,
ADD COLUMN     "resolutionUrl" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "yesCondition" TEXT;

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "token",
ADD COLUMN     "encryptedWek" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordHash" TEXT NOT NULL;

-- DropTable
DROP TABLE "accounts";

-- DropTable
DROP TABLE "verifications";

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_transactions" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "txType" TEXT NOT NULL,
    "onChainMarketId" TEXT,
    "userAddress" TEXT,
    "valueWei" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executionResult" TEXT,
    "errorDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "contract_transactions_txHash_key" ON "contract_transactions"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "contract_events_transactionHash_eventType_key" ON "contract_events"("transactionHash", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "market_positions_userId_marketId_side_key" ON "market_positions"("userId", "marketId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

