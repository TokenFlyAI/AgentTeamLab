# T1040 QA Plan — Correlation Engine Security Fix Verification

- task_id: T1044
- agent: frank
- generated_at: 2026-04-08T04:07:57Z
- target_fix: T1038
- target_service: `output/bob/backend/services/correlation_engine/server.js`

## Purpose
Verify Bob's T1038 fixes for Heidi's four findings on the correlation engine: auth, path traversal, body size limit, and error leakage.

## Preconditions
1. Run in production mode so auth misconfiguration and 500 redaction are enforced.
2. Export a known key before starting the service:

```bash
export NODE_ENV=production
export INTERNAL_API_KEY=qa_test_internal_key
node ../../output/bob/backend/services/correlation_engine/server.js
```

3. In a second terminal, define reusable variables:

```bash
export BASE_URL=http://localhost:3210
export AUTH_HEADER="Authorization: Bearer qa_test_internal_key"
export BAD_AUTH_HEADER="Authorization: Bearer wrong_key"
```

4. Confirm liveness first:

```bash
curl -i "$BASE_URL/health"
```

Expected:
- HTTP `200`
- JSON body includes `"ok": true`
- `/health` remains reachable without auth

## Test Cases

### TC-1 Missing auth is rejected on `GET /correlate`
```bash
curl -i "$BASE_URL/correlate"
```

Expected:
- HTTP `401`
- Body contains `Missing Authorization header`
- No correlation payload is returned

### TC-2 Invalid bearer token is rejected on `POST /correlate`
```bash
curl -i -X POST "$BASE_URL/correlate" \
  -H "$BAD_AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"clusters":[]}'
```

Expected:
- HTTP `403`
- Body contains `Invalid internal API key`
- No correlation payload is returned

### TC-3 Valid bearer token succeeds on `POST /correlate`
```bash
curl -i -X POST "$BASE_URL/correlate" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"clusters":[]}'
```

Expected:
- HTTP `200`
- Response headers include `X-Schema-Version: v1`
- Body contains `"ok": true`

### TC-4 Path traversal outside allowlist is blocked
```bash
curl -i -X POST "$BASE_URL/correlate" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"path":"/etc/passwd"}'
```

Expected:
- HTTP `403`
- Body contains `Path not in allowed directories`
- Response must not include file contents or absolute allowed paths

### TC-5 Allowed path still works
Use an existing repo artifact such as `../../output/bob/t852/market_clusters.json`.

```bash
curl -i -X POST "$BASE_URL/correlate" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"path":"../../output/bob/t852/market_clusters.json"}'
```

Expected:
- HTTP `200`
- Body contains `"ok": true`
- Body contains `total_pairs_analyzed`

### TC-6 Oversized request body is rejected
Generate a payload larger than the configured 1 MiB limit.

```bash
node -e 'const n="x".repeat(1100000); process.stdout.write(JSON.stringify({clusters:[{name:n,markets:[]}]}));' > /tmp/correlation_oversize.json
curl -i -X POST "$BASE_URL/correlate" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/correlation_oversize.json
```

Expected:
- Request is rejected before processing
- Accept either connection close or HTTP `400` with `Request body too large`
- Service stays alive: `curl -i "$BASE_URL/health"` still returns `200` immediately after

### TC-7 Internal error details are redacted in production
Send a structurally invalid but allowlisted JSON file path to force a server-side parse failure.

```bash
printf 'not json\n' > /tmp/not_json.txt
cp /tmp/not_json.txt ../../output/frank/not_json.txt
curl -i -X POST "$BASE_URL/correlate" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"path":"../../output/frank/not_json.txt"}'
```

Expected:
- HTTP `500`
- Body contains `Correlation failed: Internal error`
- Body does not contain `Unexpected token`, stack traces, absolute file paths, or parser internals

## Execution Notes
- Severity if TC-1, TC-2, TC-4, or TC-7 fails: `critical`
- Severity if TC-6 fails: `major`
- Severity if TC-5 fails while the rest pass: `major`
- Record for each failure: exact command, status code, full response body, and whether the service remained healthy afterward

## Risks / QA Notes
- The current implementation intentionally allows auth passthrough when `INTERNAL_API_KEY` is unset outside production. Do not run this verification in dev mode.
- The current implementation redacts internal error details only when `NODE_ENV=production`. A non-production run is not valid evidence for T1040.
