-- AI Avatar Finder & Generator: cached embeddings, generation jobs, generated images.
-- AlterTable
ALTER TABLE "Avatar" ADD COLUMN "embedding" TEXT;
ALTER TABLE "Avatar" ADD COLUMN "embeddingHash" TEXT;
ALTER TABLE "Avatar" ADD COLUMN "embeddingModel" TEXT;

-- CreateTable
CREATE TABLE "AiGenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AiGenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedAvatar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAvatarId" TEXT,
    CONSTRAINT "GeneratedAvatar_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiGenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GeneratedAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GeneratedAvatar_publishedAvatarId_fkey" FOREIGN KEY ("publishedAvatarId") REFERENCES "Avatar" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiGenerationJob_userId_createdAt_idx" ON "AiGenerationJob"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedAvatar_fileKey_key" ON "GeneratedAvatar"("fileKey");

-- CreateIndex
CREATE INDEX "GeneratedAvatar_userId_createdAt_idx" ON "GeneratedAvatar"("userId", "createdAt");
