#!/usr/bin/env bash

set -Eeuo pipefail

COMPOSE_FILE="docker-compose.e2e.yml"

ENV_FILE=".env.e2e"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: ${ENV_FILE} not found"
    exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${KMS_PROVIDER:?KMS_PROVIDER is required in ${ENV_FILE}}"
: "${LOCAL_KMS_MASTER_KEY:?LOCAL_KMS_MASTER_KEY is required in ${ENV_FILE}}"

IMAGE_NAME="${IMAGE_NAME:-blockchain-transaction-simulator:e2e}"

API_URL="${E2E_API_URL:-http://localhost:3002}"
RPC_URL="${E2E_RPC_URL:-http://localhost:8546}"
FIXTURE_FILE="${E2E_FIXTURE_FILE:-/tmp/blockchain-e2e/fixtures.json}"

export IMAGE_NAME
export E2E_API_URL="${API_URL}"
export E2E_RPC_URL="${RPC_URL}"
export E2E_FIXTURE_FILE="${FIXTURE_FILE}"

cleanup() {
    echo
    echo "Cleaning up E2E environment..."

    docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans

    echo "E2E cleanup completed."
}

trap cleanup EXIT

echo "=================================================="
echo " Blockchain Transaction Simulator - E2E"
echo "=================================================="
echo
echo "IMAGE_NAME=${IMAGE_NAME}"
echo "API_URL=${E2E_API_URL}"
echo "RPC_URL=${E2E_RPC_URL}"
echo "FIXTURE_FILE=${E2E_FIXTURE_FILE}"
echo

echo "--------------------------------------------------"
echo "1. Building E2E application image"
echo "--------------------------------------------------"

docker build \
    --target runtime \
    -t "${IMAGE_NAME}" \
    -f docker/Dockerfile \
    .

echo
echo "--------------------------------------------------"
echo "2. Starting E2E infrastructure"
echo "--------------------------------------------------"

docker compose -f "${COMPOSE_FILE}" up -d \
    postgres \
    redis \
    anvil

echo "Waiting for infrastructure..."

until docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    pg_isready \
    -U postgres \
    -d blockchain_simulator_e2e \
    >/dev/null 2>&1
do
    sleep 1
done

echo "Postgres is ready."

until docker compose -f "${COMPOSE_FILE}" exec -T redis \
    redis-cli ping \
    >/dev/null 2>&1
do
    sleep 1
done

echo "Redis is ready."

until docker compose -f "${COMPOSE_FILE}" exec -T anvil \
    cast chain-id \
    --rpc-url http://127.0.0.1:8545 \
    >/dev/null 2>&1
do
    sleep 1
done

echo "Anvil is ready."

echo
echo "--------------------------------------------------"
echo "3. Running database migration"
echo "--------------------------------------------------"

docker compose -f "${COMPOSE_FILE}" run --rm migration

echo
echo "--------------------------------------------------"
echo "4. Starting API"
echo "--------------------------------------------------"

docker compose -f "${COMPOSE_FILE}" up -d api

echo "Waiting for E2E API..."

until curl --fail --silent "${API_URL}/api/v1/health" >/dev/null 2>&1
do
    sleep 2
done

echo "E2E API is ready."

echo
echo "--------------------------------------------------"
echo "5. Preparing E2E fixture"
echo "--------------------------------------------------"

E2E_API_URL="${API_URL}" \
E2E_RPC_URL="${RPC_URL}" \
E2E_FIXTURE_FILE="${FIXTURE_FILE}" \
npm run e2e:setup

echo
echo "--------------------------------------------------"
echo "6. Starting worker"
echo "--------------------------------------------------"

docker compose -f "${COMPOSE_FILE}" up -d worker

echo "Waiting for worker..."

until curl --fail --silent "http://localhost:3003/health" >/dev/null 2>&1
do
    sleep 1
done

echo "Worker is ready."

echo
echo "--------------------------------------------------"
echo "7. Running E2E tests"
echo "--------------------------------------------------"

vitest run --config vitest.e2e.config.ts

echo
echo "=================================================="
echo " E2E TEST PASSED"
echo "=================================================="