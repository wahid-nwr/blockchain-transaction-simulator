#!/usr/bin/env bash

set -euo pipefail


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


if [ ! -f "${PREVIOUS_FILE}" ]; then
    echo "ERROR: No previous deployment available"
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


export IMAGE="${ROLLBACK_IMAGE}"


#
# Validate image
#

if ! docker image inspect "${ROLLBACK_IMAGE}" >/dev/null 2>&1
then
    echo "ERROR: image not found:"
    echo "${ROLLBACK_IMAGE}"
    exit 1
fi



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
 -f "${COMPOSE_FILE}" \
 up -d



#
# Health verification
#

echo
echo "Running health verification..."

"${PROJECT_ROOT}/scripts/health-check.sh" "${ROLLBACK_IMAGE}"


if [ -x "${PROJECT_ROOT}/scripts/smoke-test.sh" ]
then
    "${PROJECT_ROOT}/scripts/smoke-test.sh" "${ROLLBACK_IMAGE}"
fi



#
# Update deployment pointers
#

echo
echo "Updating deployment metadata..."


mkdir -p "${HISTORY_DIR}"


ROLLBACK_ID=$(date +"%Y%m%d-%H%M%S")



#
# Save failed deployment
#

if [ -f "${CURRENT_FILE}" ]
then

    cp \
      "${CURRENT_FILE}" \
      "${HISTORY_DIR}/${ROLLBACK_ID}-rollback.env"

fi



#
# Promote previous -> current
#

cp "${PREVIOUS_FILE}" "${CURRENT_FILE}"



#
# Restore previous pointer from old current
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
echo "Rollback completed"
echo "================================="