#!/usr/bin/env bash

set -euo pipefail


ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

IMAGE="${1:-blockchain-transaction-simulator:latest}"

export IMAGE


echo "================================="
echo "Running deployment smoke tests"
echo "================================="

echo
echo "Using image: ${IMAGE}"
echo "================================="
echo "Running deployment smoke tests"
echo "================================="

API_URL=${API_URL:-http://localhost:3000}
WORKER_URL=${WORKER_URL:-http://localhost:3001}

FAILED=0


check_endpoint() {
  NAME=$1
  URL=$2

  echo "Checking ${NAME}..."

  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" || true)

  if [ "$RESPONSE" != "200" ]; then
    echo "ERROR: ${NAME} failed (${RESPONSE})"
    FAILED=1
  else
    echo "${NAME} OK"
  fi
}


echo ""
echo "Checking API health..."
check_endpoint \
  "API health" \
  "${API_URL}/api/v1/health"


echo ""
echo "Checking worker health..."
check_endpoint \
  "Worker health" \
  "${WORKER_URL}/health"


echo ""
echo "Checking metrics endpoints..."

check_endpoint \
  "API metrics" \
  "${API_URL}/api/v1/metrics"


check_endpoint \
  "Worker metrics" \
  "${WORKER_URL}/metrics"


echo ""
echo "Checking running containers..."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps


echo ""

if [ "$FAILED" -ne 0 ]; then
  echo "================================="
  echo "Smoke tests FAILED"
  echo "================================="
  exit 1
fi


echo "================================="
echo "Smoke tests PASSED"
echo "================================="