#!/usr/bin/env bash

set -euo pipefail


VERSION=${1:-latest}

IMAGE_NAME="blockchain-transaction-simulator"

REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_OWNER="${GITHUB_REPOSITORY_OWNER:-${IMAGE_OWNER:-your-org-name}}"

FULL_IMAGE="${REGISTRY}/${IMAGE_OWNER}/${IMAGE_NAME}"

GIT_SHA=$(git rev-parse HEAD)

SHORT_SHA=$(git rev-parse --short HEAD)

IMAGE_TAG="sha-${SHORT_SHA}"

IMAGE="${FULL_IMAGE}:${IMAGE_TAG}"


echo "================================="
echo "Building Docker image"
echo "================================="

echo "Version: ${VERSION}"
echo "Image: ${IMAGE}"

echo


docker build \
  -f docker/Dockerfile \
  -t "${IMAGE}" \
  .


DEPLOYMENT_ID=$(date +"%Y%m%d-%H%M%S")

CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")


mkdir -p deployments


cat > deployments/new.env <<EOF
IMAGE=${IMAGE}
VERSION=${VERSION}
GIT_SHA=${GIT_SHA}
DEPLOYMENT_ID=${DEPLOYMENT_ID}
CREATED_AT=${CREATED_AT}
EOF


echo
echo "================================="
echo "Build completed successfully"
echo "================================="

echo
cat deployments/new.env