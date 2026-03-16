# ===== Stage 1: Build shared types =====
FROM node:22-alpine AS shared-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
RUN npm install --workspace=packages/shared
COPY packages/shared packages/shared
COPY tsconfig.base.json .
RUN npm run build --workspace=packages/shared

# ===== Stage 2: Build client =====
FROM node:22-alpine AS client-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN npm install --workspace=packages/client --workspace=packages/shared
COPY tsconfig.base.json .
COPY --from=shared-build /app/packages/shared packages/shared
COPY packages/client packages/client
RUN npm run build --workspace=packages/client

# ===== Stage 3: Build server =====
FROM node:22-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm install --workspace=packages/server --workspace=packages/shared
COPY tsconfig.base.json .
COPY --from=shared-build /app/packages/shared packages/shared
COPY packages/server packages/server
RUN npm run build --workspace=packages/server

# ===== Stage 4: Production =====
FROM node:22-alpine AS production

# Install tini for proper signal handling and ffprobe for M4B chapters
RUN apk add --no-cache tini ffmpeg

# Create non-root user
RUN addgroup -g 1001 npcshelf && adduser -u 1001 -G npcshelf -s /bin/sh -D npcshelf

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm install --workspace=packages/server --workspace=packages/shared --omit=dev && npm cache clean --force

# Copy built artifacts
COPY --from=shared-build /app/packages/shared/dist packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json packages/shared/
COPY --from=server-build /app/packages/server/dist packages/server/dist
COPY --from=server-build /app/packages/server/package.json packages/server/
COPY --from=client-build /app/packages/client/dist packages/client/dist

# Create data directories
RUN mkdir -p /data /config /cache/covers && chown -R npcshelf:npcshelf /data /config /cache /app

USER npcshelf

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/npc-shelf.db
ENV COVER_CACHE_PATH=/cache/covers

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

VOLUME ["/data", "/config", "/cache"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/server/dist/index.js"]

# ===== Stage 5: All-in-one (Debian + Calibre + ffmpeg) =====
FROM node:22-slim AS production-aio

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ffmpeg wget \
    && apt-get install -y calibre \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 npcshelf && useradd -u 1001 -g npcshelf -m -s /bin/sh npcshelf

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN npm install --workspace=packages/server --workspace=packages/shared --omit=dev && npm cache clean --force

COPY --from=shared-build /app/packages/shared/dist packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json packages/shared/
COPY --from=server-build /app/packages/server/dist packages/server/dist
COPY --from=server-build /app/packages/server/package.json packages/server/
COPY --from=client-build /app/packages/client/dist packages/client/dist

RUN mkdir -p /data /config /cache/covers && chown -R npcshelf:npcshelf /data /config /cache /app

USER npcshelf

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/npc-shelf.db
ENV COVER_CACHE_PATH=/cache/covers

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

VOLUME ["/data", "/config", "/cache"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
