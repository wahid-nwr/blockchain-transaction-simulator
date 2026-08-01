#!/usr/bin/env bash

set -euo pipefail

echo "================================="
echo "Running deployment health checks"
echo "================================="

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

IMAGE="${1:-blockchain-transaction-simulator:latest}"

export IMAGE


MAX_RETRIES=12
RETRY_DELAY=5


retry_check() {
    local name="$1"
    local command="$2"

    echo
    echo "Checking ${name}..."

    for attempt in $(seq 1 "${MAX_RETRIES}"); do

        if eval "${command}"; then
            echo "${name} OK"
            return 0
        fi

        echo "${name} not ready (${attempt}/${MAX_RETRIES}), retrying..."

        if [ "${attempt}" -eq "${MAX_RETRIES}" ]; then
            echo "ERROR: ${name} failed"
            return 1
        fi

        sleep "${RETRY_DELAY}"

    done
}


echo "Using image: ${IMAGE}"


echo
echo "Checking containers..."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps



retry_check \
  "API health" \
  "curl --fail --silent http://localhost:3000/api/v1/health >/dev/null"



retry_check \
  "Worker health" \
  "curl --fail --silent http://localhost:3001/health >/dev/null"



retry_check \
  "Prometheus health" \
  "curl --fail --silent http://localhost:9090/-/healthy >/dev/null"



retry_check \
  "API metrics" \
  "curl --fail --silent http://localhost:3000/api/v1/metrics >/dev/null"



retry_check \
  "Worker metrics" \
  "curl --fail --silent http://localhost:3001/metrics >/dev/null"



echo
echo "Checking container status..."

FAILED=$(docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps \
  --format json |
  jq -r '
    select(
      .Service != "migration"
      and .State == "exited"
    )
    | .Service
  ')


if [ -n "$FAILED" ]; then
    echo "ERROR: Failed containers:"
    echo "$FAILED"
    exit 1
fi

echo "Container status OK"


echo
echo "================================="
echo "Deployment healthy"
echo "================================="