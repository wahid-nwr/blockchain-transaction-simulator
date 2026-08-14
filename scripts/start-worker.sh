#!/usr/bin/env bash

set -e

echo "Starting worker service..."

./scripts/wait-for-postgres.sh

./scripts/migrate.sh

echo "Launching worker..."

exec node dist/workers/confirmation.queue.runner.js