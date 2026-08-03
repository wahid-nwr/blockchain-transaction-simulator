#!/usr/bin/env bash

set -euo pipefail

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

IMAGE="${1:-blockchain-transaction-simulator:latest}"

export IMAGE

echo "Running database migrations..."

npx prisma migrate deploy

echo "Database migrations completed."