#!/usr/bin/env bash

set -euo pipefail

VERSION=${1:-latest}

IMAGE_NAME="blockchain-transaction-simulator"

VERSION_IMAGE="${IMAGE_NAME}:${VERSION}"
LATEST_IMAGE="${IMAGE_NAME}:latest"

echo "================================="
echo "Building Docker image"
echo "================================="

echo "Version: ${VERSION}"
echo "Image: ${VERSION_IMAGE}"

echo

docker build \
  -f docker/Dockerfile \
  -t "${VERSION_IMAGE}" \
  .

docker tag \
  "${VERSION_IMAGE}" \
  "${LATEST_IMAGE}"


DEPLOYMENT_ID=$(date +"%Y%m%d-%H%M%S")

mkdir -p deployments

cat > deployments/new.env <<EOF
IMAGE=${VERSION_IMAGE}
DEPLOYMENT_ID=${DEPLOYMENT_ID}
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF


echo
echo "================================="
echo "Build completed successfully"
echo "================================="

echo
echo "Images:"
echo "${VERSION_IMAGE}"
echo "${LATEST_IMAGE}"

echo
cat deployments/new.env