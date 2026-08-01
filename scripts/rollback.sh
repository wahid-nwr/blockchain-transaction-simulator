#!/usr/bin/env bash

set -e


echo "================================="
echo "Starting rollback"
echo "================================="


if [ ! -f deployments/previous ]; then
    echo "ERROR: No previous deployment found"
    exit 1
fi


source deployments/previous


echo "Rolling back to:"
echo "${IMAGE}"


export IMAGE


docker compose \
 --env-file .env.production \
 -f docker-compose.prod.yml \
 down



docker compose \
 --env-file .env.production \
 -f docker-compose.prod.yml \
 up -d



echo "Running health verification..."

./scripts/health-check.sh



echo ""
echo "================================="
echo "Rollback completed"
echo "================================="