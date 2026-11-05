-- AlterTable
ALTER TABLE "User" ADD COLUMN "department" TEXT;
ALTER TABLE "User" ADD COLUMN "designation" TEXT;
ALTER TABLE "User" ADD COLUMN "emailChangeExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "emailChangeTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_emailChangeTokenHash_key" ON "User"("emailChangeTokenHash");

