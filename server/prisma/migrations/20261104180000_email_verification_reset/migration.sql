-- Email verification for public sign-up, and password reset.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "verifyTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "verifyExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "resetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "resetExpiresAt" DATETIME;

CREATE UNIQUE INDEX "User_verifyTokenHash_key" ON "User"("verifyTokenHash");
CREATE UNIQUE INDEX "User_resetTokenHash_key" ON "User"("resetTokenHash");

-- Accounts that already have a password were provisioned or invited (the invite link proved the
-- address), so they count as verified. Pending invites stay unverified until accepted.
UPDATE "User" SET "emailVerifiedAt" = COALESCE("lastLoginAt", "createdAt") WHERE "passwordHash" IS NOT NULL;
