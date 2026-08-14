-- CreateIndex
CREATE INDEX "Transaction_status_submittedAt_idx" ON "Transaction"("status", "submittedAt");
