#!/bin/sh
# Applies any pending database migrations (non-destructive), then starts the API.
set -e
cd /app/server
npx prisma migrate deploy --schema prisma/schema.prisma
exec node dist/index.js
