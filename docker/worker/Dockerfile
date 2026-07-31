# -----------------------------------------------------------------------------
# Builder
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    npx prisma generate

RUN npm run compile

RUN npm run build

RUN npm prune --omit=dev


# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/artifacts ./artifacts
COPY --from=builder /app/scripts ./scripts

RUN chmod +x ./scripts/*.sh

CMD ["./scripts/start-worker.sh"]