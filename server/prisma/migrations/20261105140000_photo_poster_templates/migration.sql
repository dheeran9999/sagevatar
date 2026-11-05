-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PosterTemplate" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "heading" TEXT NOT NULL DEFAULT 'Happy Work Anniversary!',
    "maxParticipants" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'illustrated',
    "photoKey" TEXT,
    "photoWidth" INTEGER,
    "photoHeight" INTEGER,
    "faceSlots" JSONB,
    "showNames" BOOLEAN NOT NULL DEFAULT true,
    "rightsConfirmedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "PosterTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PosterTemplate" ("description", "heading", "isPublished", "key", "maxParticipants", "name", "sortOrder", "updatedAt", "updatedById") SELECT "description", "heading", "isPublished", "key", "maxParticipants", "name", "sortOrder", "updatedAt", "updatedById" FROM "PosterTemplate";
DROP TABLE "PosterTemplate";
ALTER TABLE "new_PosterTemplate" RENAME TO "PosterTemplate";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

