-- Photo output & sharing: email log for event photos, generated-avatar link on creations.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmailActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "delivery" TEXT,
    "userId" TEXT NOT NULL,
    "creationId" TEXT,
    "eventPhotoId" TEXT,
    CONSTRAINT "EmailActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailActivity_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "PhotoCreation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailActivity_eventPhotoId_fkey" FOREIGN KEY ("eventPhotoId") REFERENCES "EventPhoto" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmailActivity" ("createdAt", "creationId", "error", "id", "providerMessageId", "recipient", "sentAt", "status", "subject", "userId") SELECT "createdAt", "creationId", "error", "id", "providerMessageId", "recipient", "sentAt", "status", "subject", "userId" FROM "EmailActivity";
DROP TABLE "EmailActivity";
ALTER TABLE "new_EmailActivity" RENAME TO "EmailActivity";
CREATE INDEX "EmailActivity_userId_createdAt_idx" ON "EmailActivity"("userId", "createdAt");
CREATE INDEX "EmailActivity_status_createdAt_idx" ON "EmailActivity"("status", "createdAt");
CREATE TABLE "new_PhotoCreation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "sourcePath" TEXT NOT NULL,
    "resultPath" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "avatarId" TEXT,
    "generatedAvatarId" TEXT,
    "templateId" TEXT,
    CONSTRAINT "PhotoCreation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PhotoCreation_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PhotoCreation_generatedAvatarId_fkey" FOREIGN KEY ("generatedAvatarId") REFERENCES "GeneratedAvatar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PhotoCreation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CorporateTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PhotoCreation" ("avatarId", "createdAt", "id", "layout", "resultPath", "sourcePath", "templateId", "title", "updatedAt", "userId") SELECT "avatarId", "createdAt", "id", "layout", "resultPath", "sourcePath", "templateId", "title", "updatedAt", "userId" FROM "PhotoCreation";
DROP TABLE "PhotoCreation";
ALTER TABLE "new_PhotoCreation" RENAME TO "PhotoCreation";
CREATE INDEX "PhotoCreation_userId_createdAt_idx" ON "PhotoCreation"("userId", "createdAt");
-- Backfill: creations that recorded a generated avatar only inside their layout JSON.
UPDATE "PhotoCreation" SET "generatedAvatarId" = json_extract("layout", '$.generatedAvatarId') WHERE json_extract("layout", '$.generatedAvatarId') IN (SELECT "id" FROM "GeneratedAvatar");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
