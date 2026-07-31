#!/usr/bin/env bash

set -e

echo "Launching API..."

exec node dist/api/server.js