#!/bin/sh

set -eu

echo "Running database migrations..."

npx prisma migrate deploy

echo "Database migrations completed."