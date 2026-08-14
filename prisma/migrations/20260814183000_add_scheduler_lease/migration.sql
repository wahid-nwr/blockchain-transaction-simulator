CREATE TABLE "SchedulerLease" (
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerLease_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "SchedulerLease_expiresAt_idx" ON "SchedulerLease"("expiresAt");
