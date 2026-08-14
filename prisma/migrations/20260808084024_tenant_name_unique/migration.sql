-- DropIndex
DROP INDEX "ApiKey_tenantId_idx";

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_keyPrefix_idx" ON "ApiKey"("tenantId", "keyPrefix");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_active_idx" ON "ApiKey"("tenantId", "active");
