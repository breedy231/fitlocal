# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci

# Copy source
COPY packages/ ./packages/

# Build API (tsc) + web (vite)
RUN npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Install Litestream (amd64 — Railway runs linux/amd64)
ARG LITESTREAM_VERSION=0.3.13
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream && rm /tmp/litestream.tar.gz

# Copy built artifacts from builder
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/web/build ./packages/web/build
COPY --from=builder /app/packages/shared ./packages/shared

# Install production API dependencies only
COPY packages/api/package.json ./packages/api/
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace=packages/api --omit=dev

# Config + entrypoint
COPY litestream.yml ./litestream.yml
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
