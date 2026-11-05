# syntax=docker/dockerfile:1
# SageVatar — two images from one build:
#   target "api" : Node/Express API (Prisma + SQLite, private storage on a volume)
#   target "web" : nginx serving the built React app and proxying /api and /media to the API
# Build both with: docker compose build

# ---------------------------------------------------------------- build (both workspaces)
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cached unless package files change). Prisma's postinstall
# needs the schema, so it is copied with the manifests.
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY server/prisma server/prisma
RUN npm ci --no-audit --no-fund

COPY . .
# Server: tsc → server/dist. Client: copy MediaPipe runtimes, typecheck, vite build → client/dist.
RUN npm run build -w server && npm run build -w client

# ---------------------------------------------------------------- api runtime
FROM node:22-bookworm-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY server/prisma server/prisma
# Reuse the dependencies installed in the build stage (same Debian base, so the generated
# Prisma engine and sharp binaries match) — includes the prisma CLI for `migrate deploy`.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY docker/api-start.sh /usr/local/bin/api-start.sh
RUN chmod +x /usr/local/bin/api-start.sh && mkdir -p /data/storage
WORKDIR /app/server
EXPOSE 4000
CMD ["/usr/local/bin/api-start.sh"]

# ---------------------------------------------------------------- web runtime
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/sagevatar-locations.inc /etc/nginx/conf.d/sagevatar-locations.inc
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80 443
