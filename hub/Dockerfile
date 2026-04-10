# Knowtation Hub — self-hosted API + auth. Phase 11.
# Build from repo root: docker build -f hub/Dockerfile .
# Run with vault and data mounted; set KNOWTATION_VAULT_PATH, HUB_JWT_SECRET, OAuth env.
#
# Base image pinned to a specific patch version to guarantee a reproducible build.
# Update the tag deliberately after reviewing the Node.js 20 LTS changelog.
FROM node:20.19.0-alpine3.21

# ffmpeg: auto-transcode oversized audio for Whisper import
RUN apk add --no-cache ffmpeg

# Create a non-root user and group for runtime security.
# All application files are owned by this user; the process never runs as root.
RUN addgroup -S knowtation && adduser -S -G knowtation knowtation

WORKDIR /app

# Copy package lock files first so Docker layer caching skips re-install
# when only source files change.
COPY package.json package-lock.json* ./
COPY hub/package.json hub/package-lock.json* ./hub/

# Use `npm ci` for reproducible, lock-file-exact installs (no silent upgrades).
RUN npm ci --omit=dev
RUN cd hub && npm ci --omit=dev

COPY lib ./lib
COPY hub ./hub
COPY web/hub ./web/hub
COPY config ./config

# Transfer ownership to the non-root user before switching context.
RUN chown -R knowtation:knowtation /app

USER knowtation

# Default: vault and data via mount; server runs from /app
ENV NODE_ENV=production
ENV HUB_PORT=3333
EXPOSE 3333

# Run from repo root so loadConfig and lib resolve
WORKDIR /app
CMD ["node", "hub/server.mjs"]
