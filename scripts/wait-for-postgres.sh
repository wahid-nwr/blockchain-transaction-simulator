#!/usr/bin/env bash

set -e

echo "Waiting for PostgreSQL..."

until pg_isready \
  -h "${POSTGRES_HOST:-postgres}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-tether}" \
  -d "${POSTGRES_DB:-mini_tether}";
do
  sleep 2
done

echo "PostgreSQL is ready."