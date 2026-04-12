# Knowtation Hub — self-hosted API + auth. Phase 11.
# Build from repo root: docker build -f hub/Dockerfile .
# Run with vault and data mounted; set KNOWTATION_VAULT_PATH, HUB_JWT_SECRET, OAuth env.

FROM node:20-alpine

# ffmpeg: auto-transcode oversized audio for Whisper import
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY hub/package.json ./hub/

# Install root deps (for lib) and hub deps
RUN npm install --omit=dev
RUN cd hub && npm install --omit=dev

COPY lib ./lib
COPY hub ./hub
COPY web/hub ./web/hub
COPY config ./config

# Default: vault and data via mount; server runs from /app
ENV NODE_ENV=production
ENV HUB_PORT=3333
EXPOSE 3333

# Run from repo root so loadConfig and lib resolve
WORKDIR /app
CMD ["node", "hub/server.mjs"]
