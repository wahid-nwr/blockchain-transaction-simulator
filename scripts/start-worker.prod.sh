#!/usr/bin/env bash

set -e

echo "Launching worker..."

exec node dist/workers/confirmation.queue.runner.js