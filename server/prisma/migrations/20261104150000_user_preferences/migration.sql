-- Per-user Appearance settings (theme, accent, glass, motion, layout) stored as validated JSON.
ALTER TABLE "User" ADD COLUMN "preferences" TEXT;
