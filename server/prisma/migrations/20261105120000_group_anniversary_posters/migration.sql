-- AlterTable
ALTER TABLE "User" ADD COLUMN "employeeCode" TEXT;

-- CreateTable
CREATE TABLE "EmployeePhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "fileKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "maskKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "face" JSONB,
    "faceSource" TEXT NOT NULL DEFAULT 'none',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "consentBasis" TEXT NOT NULL,
    "consentConfirmedAt" DATETIME NOT NULL,
    "shareWithColleagues" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmployeePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmployeePhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosterTemplate" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "heading" TEXT NOT NULL DEFAULT 'Happy Work Anniversary!',
    "maxParticipants" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "PosterTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PosterBranding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'SageIT',
    "tagline" TEXT NOT NULL DEFAULT '',
    "logoKey" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "PosterBranding_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupPoster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "mode" TEXT NOT NULL,
    "modeNote" TEXT,
    "variation" INTEGER NOT NULL DEFAULT 0,
    "participants" JSONB NOT NULL,
    "resultKey" TEXT,
    "thumbKey" TEXT,
    "sceneKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "creationId" TEXT,
    "eventPhotoId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "GroupPoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupPoster_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "groupPosterId" TEXT,
    CONSTRAINT "EmailActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailActivity_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "PhotoCreation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailActivity_eventPhotoId_fkey" FOREIGN KEY ("eventPhotoId") REFERENCES "EventPhoto" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailActivity_groupPosterId_fkey" FOREIGN KEY ("groupPosterId") REFERENCES "GroupPoster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EmailActivity" ("createdAt", "creationId", "delivery", "error", "eventPhotoId", "id", "providerMessageId", "recipient", "sentAt", "status", "subject", "userId") SELECT "createdAt", "creationId", "delivery", "error", "eventPhotoId", "id", "providerMessageId", "recipient", "sentAt", "status", "subject", "userId" FROM "EmailActivity";
DROP TABLE "EmailActivity";
ALTER TABLE "new_EmailActivity" RENAME TO "EmailActivity";
CREATE INDEX "EmailActivity_userId_createdAt_idx" ON "EmailActivity"("userId", "createdAt");
CREATE INDEX "EmailActivity_status_createdAt_idx" ON "EmailActivity"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePhoto_fileKey_key" ON "EmployeePhoto"("fileKey");

-- CreateIndex
CREATE INDEX "EmployeePhoto_userId_isActive_idx" ON "EmployeePhoto"("userId", "isActive");

-- CreateIndex
CREATE INDEX "GroupPoster_userId_createdAt_idx" ON "GroupPoster"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

