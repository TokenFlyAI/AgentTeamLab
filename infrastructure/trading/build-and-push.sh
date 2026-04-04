#!/bin/bash
# build-and-push.sh — Build Kalshi trading images and push to ECR
# Usage: bash infrastructure/trading/build-and-push.sh

set -e

AWS_REGION="us-east-1"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Login to ECR
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Build and push dashboard
DOCKER_BUILDKIT=1 docker build \
  -f ../../agents/bob/backend/Dockerfile.dashboard \
  -t "tokenfly/dashboard:latest" \
  ../../agents/bob/backend

docker tag "tokenfly/dashboard:latest" \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/tokenfly/dashboard:latest"
docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/tokenfly/dashboard:latest"

# Build and push scheduler
DOCKER_BUILDKIT=1 docker build \
  -f ../../agents/bob/backend/Dockerfile.scheduler \
  -t "tokenfly/scheduler:latest" \
  ../../agents/bob/backend

docker tag "tokenfly/scheduler:latest" \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/tokenfly/scheduler:latest"
docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/tokenfly/scheduler:latest"

# Build and push monitor
DOCKER_BUILDKIT=1 docker build \
  -f ../../agents/bob/backend/Dockerfile.monitor \
  -t "tokenfly/monitor:latest" \
  ../../agents/bob/backend

docker tag "tokenfly/monitor:latest" \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/tokenfly/monitor:latest"
docker push "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/tokenfly/monitor:latest"

echo "All images pushed to ECR."
