#!/usr/bin/env bash

set -e

echo "Running database migrations..."

npx prisma migrate deploy

echo "Database migrations completed."