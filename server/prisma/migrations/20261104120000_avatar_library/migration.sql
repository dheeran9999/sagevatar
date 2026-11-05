-- Avatar library: descriptions, tags, style, source & licensing, and private storage keys.
-- Hand-edited so existing rows keep their files: /media/<kind>/<file> URLs become
-- private keys library/<kind>/<file>. Files are moved on disk by src/lib/library-storage.ts.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Avatar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT 'CASUAL',
    "typeCode" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "isAnimated" BOOLEAN NOT NULL DEFAULT false,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "defaultPlacement" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "sourceName" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT,
    "licenseName" TEXT NOT NULL DEFAULT '',
    "licenseUrl" TEXT,
    "licenseNotes" TEXT NOT NULL DEFAULT '',
    "attribution" TEXT NOT NULL DEFAULT '',
    "licenseExpiresAt" DATETIME,
    "rightsConfirmedAt" DATETIME,
    "rightsConfirmedById" TEXT,
    "categoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "Avatar_typeCode_fkey" FOREIGN KEY ("typeCode") REFERENCES "AvatarType" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Avatar_rightsConfirmedById_fkey" FOREIGN KEY ("rightsConfirmedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Avatar_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AvatarCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Avatar_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Avatar" ("categoryId", "createdAt", "createdById", "defaultPlacement", "height", "id", "isActive", "isAnimated", "mimeType", "name", "sizeBytes", "typeCode", "updatedAt", "width", "fileKey", "thumbKey", "sourceType", "sourceName", "licenseName")
SELECT "categoryId", "createdAt", "createdById", "defaultPlacement", "height", "id", "isActive", "isAnimated", "mimeType", "name", "sizeBytes", "typeCode", "updatedAt", "width",
  replace("fileUrl", '/media/avatars/', 'library/avatars/'),
  replace("thumbnailUrl", '/media/avatars/', 'library/avatars/'),
  'ORIGINAL', 'SageAvatar Studio placeholder generator', 'Original work — SageIT internal use'
FROM "Avatar";
DROP TABLE "Avatar";
ALTER TABLE "new_Avatar" RENAME TO "Avatar";
CREATE UNIQUE INDEX "Avatar_fileKey_key" ON "Avatar"("fileKey");
CREATE INDEX "Avatar_categoryId_typeCode_isActive_idx" ON "Avatar"("categoryId", "typeCode", "isActive");
CREATE TABLE "new_CorporateTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "fileKey" TEXT NOT NULL,
    "thumbKey" TEXT,
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
INSERT INTO "new_CorporateTemplate" ("createdAt", "createdById", "description", "height", "id", "isActive", "layout", "mimeType", "name", "sizeBytes", "updatedAt", "width", "fileKey", "thumbKey")
SELECT "createdAt", "createdById", "description", "height", "id", "isActive", "layout", "mimeType", "name", "sizeBytes", "updatedAt", "width",
  replace("fileUrl", '/media/templates/', 'library/templates/'),
  replace("thumbnailUrl", '/media/templates/', 'library/templates/')
FROM "CorporateTemplate";
DROP TABLE "CorporateTemplate";
ALTER TABLE "new_CorporateTemplate" RENAME TO "CorporateTemplate";
CREATE UNIQUE INDEX "CorporateTemplate_fileKey_key" ON "CorporateTemplate"("fileKey");
CREATE INDEX "CorporateTemplate_isActive_idx" ON "CorporateTemplate"("isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

