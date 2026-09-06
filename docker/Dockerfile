# -----------------------------------------------------------------------------
# Builder
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    npx prisma generate

RUN npm run compile

RUN npm run build


# -----------------------------------------------------------------------------
# Migration
# -----------------------------------------------------------------------------
FROM builder AS migration

ENV NODE_ENV=production

CMD ["npx", "prisma", "migrate", "deploy"]


# -----------------------------------------------------------------------------
# Production dependency builder
# -----------------------------------------------------------------------------
FROM builder AS production-builder

RUN npm prune --omit=dev


# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

ARG APT_CACHE_BUST=unset
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        curl \
        postgresql-client \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm

COPY --from=production-builder /app/package*.json ./
COPY --from=production-builder /app/node_modules ./node_modules
COPY --from=production-builder /app/dist ./dist
COPY --from=production-builder /app/prisma ./prisma
COPY --from=production-builder /app/artifacts ./artifacts
COPY --from=production-builder /app/scripts ./scripts

RUN chmod +x ./scripts/*.sh

EXPOSE 3000

CMD ["node"]