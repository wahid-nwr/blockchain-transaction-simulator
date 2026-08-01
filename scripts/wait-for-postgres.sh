#!/usr/bin/env bash

set -euo pipefail


if [ -z "${POSTGRES_HOST:-}" ]; then
    POSTGRES_HOST=localhost
fi

POSTGRES_PORT=${POSTGRES_PORT:-65432}
POSTGRES_USER=${POSTGRES_USER:-tether}
POSTGRES_DB=${POSTGRES_DB:-mini_tether}

TIMEOUT=${POSTGRES_TIMEOUT:-60}


echo "Waiting for PostgreSQL..."
echo "Host: ${POSTGRES_HOST}:${POSTGRES_PORT}"
echo "Database: ${POSTGRES_DB}"


SECONDS_WAITED=0


until pg_isready \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}";
do

    if [ "${SECONDS_WAITED}" -ge "${TIMEOUT}" ]; then
        echo "ERROR: PostgreSQL did not become ready within ${TIMEOUT}s"
        exit 1
    fi

    sleep 2
    SECONDS_WAITED=$((SECONDS_WAITED + 2))

done


echo "PostgreSQL is ready"