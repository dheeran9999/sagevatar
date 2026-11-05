-- Phase 2: authentication, roles and RBAC.
-- Hand-edited from `prisma migrate diff` so existing rows survive the column renames:
--   User.role -> User.roleCode, Avatar.type -> Avatar.typeCode, Avatar.isPublished -> Avatar.isActive.
-- Composition and EmailLog were empty (verified) and are replaced by PhotoCreation and EmailActivity.
-- DropIndex
DROP INDEX "Composition_userId_createdAt_idx";

-- DropIndex
DROP INDEX "EmailLog_userId_createdAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Composition";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EmailLog";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Role" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AvatarType" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "defaultPlacement" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- Seed reference data: exactly two roles and the four avatar types.
INSERT INTO "Role" ("code", "name", "description") VALUES
  ('CREATOR', 'Creator', 'Manages the avatar library, templates and employee accounts.'),
  ('EMPLOYEE', 'Employee', 'Creates, downloads and emails personal photo compositions.');
INSERT INTO "AvatarType" ("code", "name", "description", "defaultPlacement", "sortOrder", "isActive", "updatedAt") VALUES
  ('FACE', 'Face', 'Head-only avatar placed near the person.', '{"layer":"front","x":0.78,"y":0.3,"scale":0.35}', 1, true, CURRENT_TIMESTAMP),
  ('HALF_BODY', 'Half Body', 'Waist-up avatar placed beside the person.', '{"layer":"beside","x":0.75,"y":0.55,"scale":0.7}', 2, true, CURRENT_TIMESTAMP),
  ('FULL_BODY', 'Full Body', 'Full-length avatar, can stand behind the person.', '{"layer":"behind","x":0.72,"y":0.5,"scale":0.95}', 3, true, CURRENT_TIMESTAMP),
  ('BACKGROUND', 'Background', 'Scene that replaces the photo background.', '{"layer":"background","x":0.5,"y":0.5,"scale":1}', 4, true, CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "CorporateTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "CorporateTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhotoCreation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "sourcePath" TEXT NOT NULL,
    "resultPath" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "avatarId" TEXT,
    "templateId" TEXT,
    CONSTRAINT "PhotoCreation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PhotoCreation_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PhotoCreation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CorporateTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhotoMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationId" TEXT NOT NULL,
    CONSTRAINT "PhotoMetadata_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "PhotoCreation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "userId" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    CONSTRAINT "EmailActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailActivity_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "PhotoCreation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Avatar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "isAnimated" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "defaultPlacement" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "Avatar_typeCode_fkey" FOREIGN KEY ("typeCode") REFERENCES "AvatarType" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Avatar_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AvatarCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Avatar_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Avatar" ("categoryId", "createdAt", "createdById", "defaultPlacement", "fileUrl", "height", "id", "isAnimated", "mimeType", "name", "thumbnailUrl", "updatedAt", "width", "typeCode", "isActive") SELECT "categoryId", "createdAt", "createdById", "defaultPlacement", "fileUrl", "height", "id", "isAnimated", "mimeType", "name", "thumbnailUrl", "updatedAt", "width", "type", "isPublished" FROM "Avatar";
DROP TABLE "Avatar";
ALTER TABLE "new_Avatar" RENAME TO "Avatar";
CREATE INDEX "Avatar_categoryId_typeCode_isActive_idx" ON "Avatar"("categoryId", "typeCode", "isActive");
CREATE TABLE "new_AvatarCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AvatarCategory" ("createdAt", "id", "isActive", "name", "slug", "sortOrder", "updatedAt") SELECT "createdAt", "id", "isActive", "name", "slug", "sortOrder", "createdAt" FROM "AvatarCategory";
DROP TABLE "AvatarCategory";
ALTER TABLE "new_AvatarCategory" RENAME TO "AvatarCategory";
CREATE UNIQUE INDEX "AvatarCategory_name_key" ON "AvatarCategory"("name");
CREATE UNIQUE INDEX "AvatarCategory_slug_key" ON "AvatarCategory"("slug");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "roleCode" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" DATETIME,
    "invitedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    CONSTRAINT "User_roleCode_fkey" FOREIGN KEY ("roleCode") REFERENCES "Role" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "id", "isActive", "lastLoginAt", "name", "passwordHash", "updatedAt", "roleCode") SELECT "createdAt", "email", "id", "isActive", "lastLoginAt", "name", "passwordHash", "updatedAt", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");
CREATE INDEX "User_roleCode_isActive_idx" ON "User"("roleCode", "isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CorporateTemplate_isActive_idx" ON "CorporateTemplate"("isActive");

-- CreateIndex
CREATE INDEX "PhotoCreation_userId_createdAt_idx" ON "PhotoCreation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoMetadata_creationId_key" ON "PhotoMetadata"("creationId");

-- CreateIndex
CREATE INDEX "EmailActivity_userId_createdAt_idx" ON "EmailActivity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailActivity_status_createdAt_idx" ON "EmailActivity"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

