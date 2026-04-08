#!/bin/bash
# deploy_phase_b_correlation.sh

# 1. Setup Redis configuration (simulated deployment)
export REDIS_PASSWORD="secure_redis_pass_123"
sed -i '' "s/\${REDIS_PASSWORD}/$REDIS_PASSWORD/g" deploy/redis.conf

# 2. Setup internal auth key for Correlation Engine
export INTERNAL_API_KEY="phase_b_correlation_secret_88"
export CORRELATION_ENGINE_PORT=3210

# 3. Start the standalone microservice
echo "Starting correlation_engine microservice on port $CORRELATION_ENGINE_PORT..."
node ../../output/shared/codebase/backend/services/correlation_engine/server.js &
PID=$!
echo $PID > deploy/service.pid

# Wait for service to boot
sleep 2

# 4. Validate Phase 2->3 data flow using Ivan's T1031 output
echo "Validating correlation endpoint with market_clusters.json..."
MARKET_CLUSTERS_PATH="$(pwd)/deploy/market_clusters.json"

HTTP_CODE=$(curl -s -w "%{http_code}" -o deploy/response.json -X POST "http://localhost:${CORRELATION_ENGINE_PORT}/correlate" \
  -H "Authorization: Bearer ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"${MARKET_CLUSTERS_PATH}\"}")

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "✅ End-to-end Phase 2->3 validation SUCCESS (HTTP $HTTP_CODE)"
  cat deploy/response.json | jq '{status, schema_version, total_pairs_analyzed, arbitrage_opportunities}'
else
  echo "❌ Validation FAILED (HTTP $HTTP_CODE)"
  cat deploy/response.json
  kill $PID
  exit 1
fi

echo "Microservice is running in background (PID $PID)."
