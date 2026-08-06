#!/usr/bin/env bash

set -euo pipefail

#
# Rollback lock
#

LOCK_FILE="/tmp/blockchain-transaction-simulator-deployment.lock"

exec 200>"${LOCK_FILE}"

flock -n 200 || {
    echo "ERROR: Another rollback is already running"
    exit 1
}

echo "================================="
echo "Starting rollback"
echo "================================="
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS_DIR="${PROJECT_ROOT}/deployments"
CURRENT_FILE="${DEPLOYMENTS_DIR}/current.env"
PREVIOUS_FILE="${DEPLOYMENTS_DIR}/previous.env"
HISTORY_DIR="${DEPLOYMENTS_DIR}/history"
ENV_FILE="${PROJECT_ROOT}/.env.production"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ROLLBACK_ID=$(date +"%Y%m%d-%H%M%S")

#
# Validate files
#
if [ ! -f "${PREVIOUS_FILE}" ]; then
    echo "ERROR: No previous deployment available"
    exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
    echo "ERROR: Missing ${ENV_FILE}"
    exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
    echo "ERROR: Missing ${COMPOSE_FILE}"
    exit 1
fi

#
# Load rollback target
#
source "${PREVIOUS_FILE}"

if [ -z "${IMAGE:-}" ]; then
    echo "ERROR: Previous IMAGE missing"
    exit 1
fi

ROLLBACK_IMAGE="${IMAGE}"

echo
echo "Rollback target:"
cat "${PREVIOUS_FILE}"
echo

#
# Validate / pull image
#
echo "Checking rollback image..."

if ! docker image inspect "${ROLLBACK_IMAGE}" >/dev/null 2>&1
then
    echo "Image missing locally"
    echo "Pulling image..."
    docker pull "${ROLLBACK_IMAGE}"
fi

#
# Resolve digest
#
IMAGE_DIGEST=$(docker image inspect \
    "${ROLLBACK_IMAGE}" \
    --format='{{index .RepoDigests 0}}' \
    2>/dev/null || true)

if [ -z "${IMAGE_DIGEST}" ]; then
    IMAGE_DIGEST="unknown"
fi

echo "Rollback image digest:"
echo "${IMAGE_DIGEST}"

export IMAGE="${ROLLBACK_IMAGE}"

#
# Capture failed deployment
#
mkdir -p "${HISTORY_DIR}"

if [ -f "${CURRENT_FILE}" ]
then
    cp \
      "${CURRENT_FILE}" \
      "${HISTORY_DIR}/${ROLLBACK_ID}-rollback.env"
fi

docker compose \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    ps \
    > "${HISTORY_DIR}/${ROLLBACK_ID}-before.txt" \
    || true

#
# Stop current deployment
#
echo "Stopping current deployment..."

IMAGE="${ROLLBACK_IMAGE}" docker compose \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    down

#
# Start rollback version
#
echo "Starting rollback deployment..."

IMAGE="${ROLLBACK_IMAGE}" docker compose \
    --env-file "${ENV_FILE}" \
    --env-file "${PREVIOUS_FILE}" \
    -f "${COMPOSE_FILE}" \
    up -d postgres api worker prometheus

#
# Health verification
#
echo
echo "Running health verification..."

if [ -x "${PROJECT_ROOT}/scripts/health-check.sh" ]
then
    "${PROJECT_ROOT}/scripts/health-check.sh" "${ROLLBACK_IMAGE}"
else
    echo "health-check.sh missing, skipping"
fi

#
# Smoke tests
#
if [ -x "${PROJECT_ROOT}/scripts/smoke-test.sh" ]
then
    "${PROJECT_ROOT}/scripts/smoke-test.sh" "${ROLLBACK_IMAGE}"
else
    echo "smoke-test.sh missing, skipping"
fi

#
# Update deployment pointers
#
echo
echo "Updating deployment metadata..."

cat > "${CURRENT_FILE}" <<EOF
IMAGE=${IMAGE}
IMAGE_DIGEST=${IMAGE_DIGEST}
VERSION=${VERSION:-unknown}
GIT_SHA=${GIT_SHA:-unknown}
DEPLOYMENT_ID=${ROLLBACK_ID}
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

#
# Preserve rollback source
#
if [ -f "${HISTORY_DIR}/${ROLLBACK_ID}-rollback.env" ]
then
    cp \
      "${HISTORY_DIR}/${ROLLBACK_ID}-rollback.env" \
      "${PREVIOUS_FILE}"
fi

echo
echo "Current deployment:"
cat "${CURRENT_FILE}"
echo
echo "Previous deployment:"
cat "${PREVIOUS_FILE}"
echo
echo "================================="
echo "Rollback completed successfully"
echo "================================="
