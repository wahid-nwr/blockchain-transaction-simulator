#!/usr/bin/env bash

set -e

echo "Starting API service..."

./scripts/wait-for-postgres.sh

./scripts/migrate.sh

echo "Launching API..."

exec node dist/api/server.js