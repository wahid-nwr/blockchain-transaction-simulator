#!/usr/bin/env bash

set -euo pipefail
#
# Deployment lock
#

LOCK_FILE="/tmp/blockchain-transaction-simulator-deployment.lock"

exec 200>"${LOCK_FILE}"

flock -n 200 || {
    echo "ERROR: Another deployment is already running"
    exit 1
}

VERSION=${1:-latest}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ENV_FILE="${PROJECT_ROOT}/.env.production"
DEPLOYMENT_DIR="${PROJECT_ROOT}/deployments"
CURRENT_ENV="${DEPLOYMENT_DIR}/current.env"
PREVIOUS_ENV="${DEPLOYMENT_DIR}/previous.env"
NEW_ENV="${DEPLOYMENT_DIR}/new.env"
HISTORY_DIR="${DEPLOYMENT_DIR}/history"
DEPLOYMENT_ID=$(date +"%Y%m%d-%H%M%S")

echo "================================="
echo "Starting production deployment"
echo "================================="

echo "Deployment ID: ${DEPLOYMENT_ID}"

#
# Load deployment metadata
#
if [ ! -f "${NEW_ENV}" ]; then
    echo "ERROR: deployment metadata not found"
    echo "Run ./scripts/build.sh ${VERSION}"
    exit 1
fi

source "${NEW_ENV}"
if [ -z "${IMAGE:-}" ]; then
    echo "ERROR: IMAGE not defined"
    exit 1
fi

if [ -z "${GIT_SHA:-}" ]; then
    echo "ERROR: GIT_SHA not defined"
    exit 1
fi

export IMAGE

echo "Using image: ${IMAGE}"

#
# Validate files
#
if [ ! -f "${ENV_FILE}" ]; then
    echo "ERROR: Missing ${ENV_FILE}"
    exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
    echo "ERROR: Missing docker-compose.prod.yml"
    exit 1
fi

#
# Load production environment
#
echo "Loading production environment..."

set -a
source "${ENV_FILE}"
set +a

#
# Validate Docker image
#
echo "Checking image..."
if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
    echo "ERROR: Docker image not found"
    echo "Image: ${IMAGE}"
    exit 1
fi

#
# Capture image digest
#
echo "Resolving image digest..."

IMAGE_DIGEST=$(docker image inspect \
    "${IMAGE}" \
    --format='{{index .RepoDigests 0}}' \
    2>/dev/null || true)

if [ -z "${IMAGE_DIGEST}" ]; then
    IMAGE_DIGEST="unknown"
fi

echo "Image digest: ${IMAGE_DIGEST}"

#
# Prepare deployment history
#
mkdir -p "${HISTORY_DIR}"

#
# Capture current running state
#
docker compose \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    ps \
    > "${HISTORY_DIR}/${DEPLOYMENT_ID}-before.txt" \
    || true

#
# Start database
#
echo "Starting database..."

IMAGE="${IMAGE}" docker compose \
    --env-file "${ENV_FILE}" \
    --env-file "${NEW_ENV}" \
    -f "${COMPOSE_FILE}" \
    up -d postgres

#
# Wait for database
#
echo "Waiting for PostgreSQL..."

MAX_RETRIES=30
COUNT=0

until IMAGE="${IMAGE}" docker compose \
    --env-file "${ENV_FILE}" \
    --env-file "${NEW_ENV}" \
    -f "${COMPOSE_FILE}" \
    exec -T postgres \
    pg_isready \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" >/dev/null 2>&1
do
    COUNT=$((COUNT+1))
    if [ "${COUNT}" -ge "${MAX_RETRIES}" ]; then
        echo "ERROR: PostgreSQL did not become ready"
        exit 1
    fi
    sleep 2
done

echo "PostgreSQL ready"

#
# Run migrations
#
echo "Running database migrations..."

IMAGE="${IMAGE}" docker compose \
    --env-file "${ENV_FILE}" \
    --env-file "${NEW_ENV}" \
    -f "${COMPOSE_FILE}" \
    run --rm migration

echo "Database migrations completed"

#
# Start application services
#
echo "Starting application services..."

IMAGE="${IMAGE}" docker compose \
    --env-file "${ENV_FILE}" \
    --env-file "${NEW_ENV}" \
    -f "${COMPOSE_FILE}" \
    up -d api worker prometheus

#
# Health verification
#
echo "Running health verification..."

if [ -x "${PROJECT_ROOT}/scripts/health-check.sh" ]; then
    "${PROJECT_ROOT}/scripts/health-check.sh" "${IMAGE}"
else
    echo "health-check.sh not found, skipping"
fi

#
# Smoke tests
#
if [ -x "${PROJECT_ROOT}/scripts/smoke-test.sh" ]; then
    "${PROJECT_ROOT}/scripts/smoke-test.sh" "${IMAGE}"
else
    echo "smoke-test.sh not found, skipping"
fi

#
# Save deployment metadata
#
cat > "${HISTORY_DIR}/${DEPLOYMENT_ID}.env" <<EOF
IMAGE=${IMAGE}
IMAGE_DIGEST=${IMAGE_DIGEST}
VERSION=${VERSION}
GIT_SHA=${GIT_SHA}
DEPLOYMENT_ID=${DEPLOYMENT_ID}
CREATED_AT=${CREATED_AT:-unknown}
EOF

#
# Update deployment metadata
#

echo "Updating deployment metadata..."
if [ -f "${CURRENT_ENV}" ]; then
    cp "${CURRENT_ENV}" "${PREVIOUS_ENV}"
fi

cat > "${CURRENT_ENV}" <<EOF
IMAGE=${IMAGE}
IMAGE_DIGEST=${IMAGE_DIGEST}
VERSION=${VERSION}
GIT_SHA=${GIT_SHA}
DEPLOYMENT_ID=${DEPLOYMENT_ID}
CREATED_AT=${CREATED_AT:-unknown}
EOF

echo "Current deployment:"

cat "${CURRENT_ENV}"

echo "Previous deployment:"

if [ -f "${PREVIOUS_ENV}" ]; then
    cat "${PREVIOUS_ENV}"
else
    echo "none"
fi

echo
echo "================================="
echo "Deployment completed successfully"
echo "================================="