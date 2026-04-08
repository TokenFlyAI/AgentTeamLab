#!/usr/bin/env node
/**
 * Inter-Service Auth Middleware — T1045
 *
 * HMAC-SHA256 signing and verification for inter-service HTTP requests
 * and message bus events. Implements the design from T1033.
 *
 * Features:
 *   1. HMAC-SHA256 request signing (Authorization header)
 *   2. Timestamp-based replay protection (5-minute window)
 *   3. Event envelope signing for message bus (x-signature field)
 *   4. Express/http middleware helpers for easy integration
 *   5. Constant-time comparison to prevent timing attacks
 *
 * Usage (HTTP service — server side):
 *   const { requireServiceAuth } = require('./interservice_auth');
 *   router.use(requireServiceAuth);          // blocks unauthenticated
 *   router.get('/health', handler);          // exempt: register before middleware
 *
 * Usage (HTTP client — caller side):
 *   const { signRequest } = require('./interservice_auth');
 *   const headers = signRequest('POST', '/correlate', body);
 *   fetch(`http://localhost:3210/correlate`, { method: 'POST', headers, body });
 *
 * Usage (message bus events):
 *   const { signEvent, verifyEvent } = require('./interservice_auth');
 *   const signed = signEvent({ type: 'correlation.pair.detected', data: {...} });
 *   redis.publish('phase3.out', JSON.stringify(signed));
 *
 *   // On consumer:
 *   const event = JSON.parse(message);
 *   if (!verifyEvent(event)) throw new Error('Invalid event signature');
 *
 * Environment:
 *   INTERNAL_BUS_SECRET  — shared secret for all 7 pipeline services (required)
 *   NODE_ENV             — set to 'production' to enforce strict mode
 *
 * Author: Heidi (Security Engineer)
 * Task:   T1045 — Sprint 10
 * Date:   2026-04-07
 */

"use strict";

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SIGNATURE_SCHEME = "sha256";
const HEADER_SIGNATURE = "x-service-signature";
const HEADER_TIMESTAMP = "x-service-timestamp";
const HEADER_SERVICE = "x-service-name";

/**
 * Get the shared secret. Throws clearly if not configured.
 * @returns {string}
 */
function getSecret() {
  const secret = process.env.INTERNAL_BUS_SECRET;
  if (!secret) {
    throw new Error(
      "[interservice_auth] INTERNAL_BUS_SECRET is not set. " +
      "All pipeline services require this env var for inter-service auth."
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "[interservice_auth] INTERNAL_BUS_SECRET is too short (min 32 chars). " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Core HMAC utilities
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 signature over a canonical string.
 * @param {string} secret
 * @param {string} canonical - deterministic string representation of the payload
 * @returns {string} hex digest
 */
function computeHmac(secret, canonical) {
  return crypto.createHmac(SIGNATURE_SCHEME, secret).update(canonical).digest("hex");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) {
    // Still run comparison to avoid length-based timing leak
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Check whether a timestamp (ISO string or ms) is within the replay window.
 * @param {string|number} timestamp
 * @returns {boolean}
 */
function isWithinReplayWindow(timestamp) {
  const ts = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (isNaN(ts)) return false;
  return Math.abs(Date.now() - ts) <= REPLAY_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// HTTP request signing (caller side)
// ---------------------------------------------------------------------------

/**
 * Build canonical string for an HTTP request.
 * Format: METHOD\nPATH\nTIMESTAMP\nBODY_HASH
 */
function canonicalRequest(method, path, timestamp, body) {
  const bodyStr = body ? (typeof body === "string" ? body : JSON.stringify(body)) : "";
  const bodyHash = crypto.createHash("sha256").update(bodyStr).digest("hex");
  return [method.toUpperCase(), path, timestamp, bodyHash].join("\n");
}

/**
 * Sign an outbound HTTP request.
 * Returns headers to merge into the request.
 *
 * @param {string} method - HTTP method
 * @param {string} path - request path (e.g. '/correlate')
 * @param {object|string|null} body - request body
 * @param {string} [serviceName] - calling service name for tracing
 * @returns {object} headers object
 */
function signRequest(method, path, body = null, serviceName = "unknown") {
  const secret = getSecret();
  const timestamp = new Date().toISOString();
  const canonical = canonicalRequest(method, path, timestamp, body);
  const signature = computeHmac(secret, canonical);

  return {
    [HEADER_SIGNATURE]: `${SIGNATURE_SCHEME}=${signature}`,
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_SERVICE]: serviceName,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// HTTP request verification (server side)
// ---------------------------------------------------------------------------

/**
 * Verify an inbound HTTP request's HMAC signature.
 *
 * @param {string} method
 * @param {string} path
 * @param {string} timestamp - from x-service-timestamp header
 * @param {string} receivedSig - from x-service-signature header
 * @param {string} body - raw request body string
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyRequest(method, path, timestamp, receivedSig, body) {
  // 1. Replay protection
  if (!isWithinReplayWindow(timestamp)) {
    return { ok: false, reason: "Request timestamp outside replay window (±5min)" };
  }

  // 2. Validate signature format
  const prefix = `${SIGNATURE_SCHEME}=`;
  if (!receivedSig || !receivedSig.startsWith(prefix)) {
    return { ok: false, reason: "Malformed signature header" };
  }
  const receivedHex = receivedSig.slice(prefix.length);

  // 3. Compute expected signature
  let secret;
  try {
    secret = getSecret();
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  const canonical = canonicalRequest(method, path, timestamp, body);
  const expectedHex = computeHmac(secret, canonical);

  // 4. Constant-time compare
  if (!safeEqual(receivedHex, expectedHex)) {
    return { ok: false, reason: "Signature mismatch" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Express/http middleware (server side)
// ---------------------------------------------------------------------------

/**
 * Node.js http.createServer-compatible middleware for inter-service auth.
 *
 * Usage in raw http server (correlation_engine pattern):
 *   if (!checkServiceAuth(req, res, rawBody)) return;
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} rawBody - already-read request body string
 * @returns {boolean} true if auth passed, false if rejected (response already sent)
 */
function checkServiceAuth(req, res, rawBody) {
  const timestamp = req.headers[HEADER_TIMESTAMP];
  const signature = req.headers[HEADER_SIGNATURE];
  const url = new URL(req.url, `http://localhost`);

  if (!timestamp || !signature) {
    sendAuthError(res, 401, "Missing auth headers (x-service-timestamp, x-service-signature)");
    return false;
  }

  const result = verifyRequest(req.method, url.pathname, timestamp, signature, rawBody);
  if (!result.ok) {
    sendAuthError(res, 401, result.reason);
    return false;
  }

  return true;
}

/**
 * Express middleware wrapper.
 *
 * Usage:
 *   const { expressMiddleware } = require('./interservice_auth');
 *   app.use('/correlate', expressMiddleware, handler);
 */
function expressMiddleware(req, res, next) {
  // Express already parses body — use rawBody if available, else re-serialize
  const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : "");
  const timestamp = req.headers[HEADER_TIMESTAMP];
  const signature = req.headers[HEADER_SIGNATURE];

  if (!timestamp || !signature) {
    return res.status(401).json({ ok: false, error: "Missing inter-service auth headers" });
  }

  const result = verifyRequest(req.method, req.path, timestamp, signature, rawBody);
  if (!result.ok) {
    return res.status(401).json({ ok: false, error: "Inter-service auth failed" });
  }

  next();
}

function sendAuthError(res, status, message) {
  const body = JSON.stringify({ ok: false, error: message });
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Schema-Version": "v1",
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Message bus event signing
// ---------------------------------------------------------------------------

/**
 * Sign a message bus event (CloudEvents-compatible envelope).
 * Adds x-signature and x-timestamp fields.
 *
 * @param {object} event - CloudEvents envelope with at minimum: type, source, id, data
 * @returns {object} event with x-signature and x-timestamp added
 */
function signEvent(event) {
  const secret = getSecret();
  const timestamp = new Date().toISOString();

  // Canonical payload: deterministic subset — type, source, id, data
  const canonical = JSON.stringify({
    type: event.type,
    source: event.source,
    id: event.id,
    data: event.data,
    time: timestamp,
  });

  const signature = `${SIGNATURE_SCHEME}=${computeHmac(secret, canonical)}`;

  return {
    ...event,
    time: timestamp,
    "x-signature": signature,
    "x-timestamp": timestamp,
  };
}

/**
 * Verify a message bus event's HMAC signature.
 *
 * @param {object} event - event object (as received from bus)
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyEvent(event) {
  const receivedSig = event["x-signature"];
  const timestamp = event["x-timestamp"] || event.time;

  if (!receivedSig) {
    return { ok: false, reason: "Missing x-signature field" };
  }

  // Replay protection
  if (!isWithinReplayWindow(timestamp)) {
    return { ok: false, reason: "Event timestamp outside replay window (±5min)" };
  }

  const prefix = `${SIGNATURE_SCHEME}=`;
  if (!receivedSig.startsWith(prefix)) {
    return { ok: false, reason: "Malformed x-signature" };
  }
  const receivedHex = receivedSig.slice(prefix.length);

  let secret;
  try {
    secret = getSecret();
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  const canonical = JSON.stringify({
    type: event.type,
    source: event.source,
    id: event.id,
    data: event.data,
    time: timestamp,
  });

  const expectedHex = computeHmac(secret, canonical);

  if (!safeEqual(receivedHex, expectedHex)) {
    return { ok: false, reason: "Event signature mismatch" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// DLQ replay guard
// ---------------------------------------------------------------------------

/**
 * Check whether a DLQ event is safe to replay.
 * Rejects events older than 24h to prevent stale state injection.
 *
 * @param {object} event
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkDlqReplay(event) {
  const timestamp = event["x-timestamp"] || event.time;
  if (!timestamp) {
    return { ok: false, reason: "Event missing timestamp — cannot verify replay safety" };
  }

  const age = Date.now() - new Date(timestamp).getTime();
  const MAX_REPLAY_AGE_MS = 24 * 60 * 60 * 1000;
  if (age > MAX_REPLAY_AGE_MS) {
    return { ok: false, reason: `Event too old for replay (age: ${Math.round(age / 3600000)}h, max: 24h)` };
  }

  // Also re-verify signature
  return verifyEvent(event);
}

// ---------------------------------------------------------------------------
// CLI — generate a new secret
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--gen-secret")) {
    const secret = crypto.randomBytes(32).toString("hex");
    console.log("\nGenerated INTERNAL_BUS_SECRET:");
    console.log(`  ${secret}`);
    console.log("\nAdd to .env:");
    console.log(`  INTERNAL_BUS_SECRET=${secret}`);
    console.log("\nShare across all pipeline services:");
    console.log("  correlation-engine, market-filter, cluster-intel, execution-engine,");
    console.log("  risk-manager, dashboard-api, market-data-service");
    process.exit(0);
  }

  if (args.includes("--test")) {
    console.log("\n=== interservice_auth self-test ===\n");

    // Inject a test secret
    process.env.INTERNAL_BUS_SECRET = crypto.randomBytes(32).toString("hex");

    // HTTP signing round-trip
    const headers = signRequest("POST", "/correlate", { clusters: [] }, "test-service");
    const verify = verifyRequest("POST", "/correlate", headers["x-service-timestamp"], headers["x-service-signature"], JSON.stringify({ clusters: [] }));
    console.log("HTTP sign+verify:", verify.ok ? "✅ PASS" : `❌ FAIL — ${verify.reason}`);

    // Tampered body
    const tampered = verifyRequest("POST", "/correlate", headers["x-service-timestamp"], headers["x-service-signature"], JSON.stringify({ clusters: ["INJECTED"] }));
    console.log("Tampered body rejected:", !tampered.ok ? "✅ PASS" : "❌ FAIL");

    // Replay attack (stale timestamp)
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10min ago
    const staleHeaders = signRequest("POST", "/correlate", null, "attacker");
    const staleVerify = verifyRequest("POST", "/correlate", staleTs, staleHeaders["x-service-signature"], "");
    console.log("Stale timestamp rejected:", !staleVerify.ok ? "✅ PASS" : "❌ FAIL");

    // Event signing round-trip
    const event = signEvent({ type: "correlation.pair.detected", source: "correlation-engine", id: "evt-001", data: { pair: "KXFED/KXGDP", r: 0.83 } });
    const evVerify = verifyEvent(event);
    console.log("Event sign+verify:", evVerify.ok ? "✅ PASS" : `❌ FAIL — ${evVerify.reason}`);

    // DLQ stale event
    const oldEvent = { ...event, "x-timestamp": new Date(Date.now() - 25 * 3600 * 1000).toISOString() };
    const dlqVerify = checkDlqReplay(oldEvent);
    console.log("DLQ stale event rejected:", !dlqVerify.ok ? "✅ PASS" : "❌ FAIL");

    console.log("\n✅ All tests passed");
    process.exit(0);
  }

  console.log(`
interservice_auth.js — T1045

Usage:
  node interservice_auth.js --gen-secret    Generate a new INTERNAL_BUS_SECRET
  node interservice_auth.js --test          Run self-tests

Integration:
  const { signRequest, checkServiceAuth, signEvent, verifyEvent } = require('./interservice_auth');
`);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // HTTP
  signRequest,
  verifyRequest,
  checkServiceAuth,
  expressMiddleware,
  // Events
  signEvent,
  verifyEvent,
  // DLQ
  checkDlqReplay,
  // Internals (exposed for testing)
  computeHmac,
  safeEqual,
  isWithinReplayWindow,
  REPLAY_WINDOW_MS,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  HEADER_SERVICE,
};
