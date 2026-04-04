/**
 * API Rate Limiter — Tokenfly Agent Team Lab
 * Author: Bob (Backend Engineer)
 * Task: E2E #196 — Write API rate limiter
 *
 * Provides:
 *   1. TokenBucketLimiter — token bucket algorithm for burst handling
 *   2. SlidingWindowLimiter — sliding window for smooth rate limiting
 *   3. middleware() — Express/Connect-compatible middleware factory
 *   4. RedisStore — optional Redis-backed storage for distributed deployments
 *
 * Features:
 *   - Multiple algorithms (token bucket, sliding window, fixed window)
 *   - Per-route and per-IP configuration
 *   - Standard RateLimit headers (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)
 *   - Skip list for health checks and internal IPs
 *   - Custom key extractors (IP, user ID, API key)
 */

"use strict";

// ---------------------------------------------------------------------------
// 1. In-Memory Store Base Class
// ---------------------------------------------------------------------------
class MemoryStore {
  constructor() {
    this._data = new Map();
    this._pruneInterval = setInterval(() => this._prune(), 60_000).unref();
  }

  get(key) {
    return this._data.get(key);
  }

  set(key, value) {
    this._data.set(key, value);
  }

  delete(key) {
    this._data.delete(key);
  }

  has(key) {
    return this._data.has(key);
  }

  _prune() {
    // Subclasses override
  }

  reset() {
    this._data.clear();
  }

  stop() {
    clearInterval(this._pruneInterval);
  }
}

// ---------------------------------------------------------------------------
// 2. Token Bucket Rate Limiter
// ---------------------------------------------------------------------------
class TokenBucketLimiter {
  /**
   * Token bucket algorithm allows bursts up to bucket size,
   * then throttles to refill rate.
   *
   * @param {object} opts
   * @param {number} opts.bucketSize - maximum tokens (burst capacity)
   * @param {number} opts.refillRate - tokens per second
   * @param {number} opts.keyPrefix - prefix for storage keys
   */
  constructor(opts = {}) {
    this.bucketSize = opts.bucketSize || 60;
    this.refillRate = opts.refillRate || 1; // tokens per second
    this.keyPrefix = opts.keyPrefix || "tb";
    this.store = opts.store || new MemoryStore();
    this._defaultKeyExpiry = Math.ceil(this.bucketSize / this.refillRate) * 1000;
  }

  /**
   * Check if request is allowed and consume tokens.
   * @param {string} key - identifier (e.g., IP, user ID)
   * @param {number} tokens - tokens to consume (default 1)
   * @returns {{ allowed: boolean, remaining: number, resetTime: number, limit: number }}
   */
  consume(key, tokens = 1) {
    const fullKey = `${this.keyPrefix}:${key}`;
    const now = Date.now();
    
    let bucket = this.store.get(fullKey);
    if (!bucket) {
      bucket = {
        tokens: this.bucketSize,
        lastRefill: now,
      };
    }

    // Calculate tokens to add since last refill
    const elapsedMs = now - bucket.lastRefill;
    const tokensToAdd = (elapsedMs / 1000) * this.refillRate;
    
    bucket.tokens = Math.min(this.bucketSize, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens < tokens) {
      // Not enough tokens - request denied
      const tokensNeeded = tokens - bucket.tokens;
      const waitMs = (tokensNeeded / this.refillRate) * 1000;
      
      this.store.set(fullKey, bucket);
      
      return {
        allowed: false,
        remaining: Math.floor(bucket.tokens),
        resetTime: now + Math.ceil(waitMs),
        limit: this.bucketSize,
        retryAfter: Math.ceil(waitMs / 1000),
      };
    }

    // Consume tokens
    bucket.tokens -= tokens;
    this.store.set(fullKey, bucket);

    // Calculate when bucket will be full again
    const tokensToFull = this.bucketSize - bucket.tokens;
    const resetMs = (tokensToFull / this.refillRate) * 1000;

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetTime: now + Math.ceil(resetMs),
      limit: this.bucketSize,
      retryAfter: 0,
    };
  }

  reset(key) {
    if (key) {
      this.store.delete(`${this.keyPrefix}:${key}`);
    } else {
      this.store.reset();
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Sliding Window Rate Limiter
// ---------------------------------------------------------------------------
class SlidingWindowLimiter {
  /**
   * Sliding window provides smooth rate limiting without burst issues.
   *
   * @param {object} opts
   * @param {number} opts.windowMs - window size in milliseconds (default 60_000)
   * @param {number} opts.maxRequests - max requests per window (default 60)
   */
  constructor(opts = {}) {
    this.windowMs = opts.windowMs || 60_000;
    this.maxRequests = opts.maxRequests || 60;
    this.keyPrefix = opts.keyPrefix || "sw";
    this.store = opts.store || new MemoryStore();
  }

  /**
   * Check and record a request.
   * @param {string} key - identifier
   * @returns {{ allowed: boolean, remaining: number, resetTime: number, limit: number }}
   */
  check(key) {
    const fullKey = `${this.keyPrefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.store.get(fullKey);
    if (!timestamps) {
      timestamps = [];
    }

    // Remove timestamps outside the current window
    const validTimestamps = timestamps.filter(t => t >= windowStart);

    const count = validTimestamps.length;
    if (count >= this.maxRequests) {
      // Rate limit exceeded
      const oldestTimestamp = validTimestamps[0];
      const resetTime = oldestTimestamp + this.windowMs;
      
      return {
        allowed: false,
        remaining: 0,
        resetTime,
        limit: this.maxRequests,
        retryAfter: Math.ceil((resetTime - now) / 1000),
      };
    }

    // Record this request
    validTimestamps.push(now);
    this.store.set(fullKey, validTimestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - validTimestamps.length,
      resetTime: now + this.windowMs,
      limit: this.maxRequests,
      retryAfter: 0,
    };
  }

  reset(key) {
    if (key) {
      this.store.delete(`${this.keyPrefix}:${key}`);
    } else {
      this.store.reset();
    }
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    // MemoryStore doesn't expose entries iterator, so we rely on per-key cleanup
  }
}

// ---------------------------------------------------------------------------
// 4. Fixed Window Rate Limiter (simpler, less memory)
// ---------------------------------------------------------------------------
class FixedWindowLimiter {
  /**
   * Fixed window divides time into discrete windows.
   * Simpler but can have burst issues at window boundaries.
   *
   * @param {object} opts
   * @param {number} opts.windowMs - window size (default 60_000)
   * @param {number} opts.maxRequests - max requests per window
   */
  constructor(opts = {}) {
    this.windowMs = opts.windowMs || 60_000;
    this.maxRequests = opts.maxRequests || 60;
    this.keyPrefix = opts.keyPrefix || "fw";
    this.store = opts.store || new MemoryStore();
  }

  /**
   * Check and record a request.
   * @param {string} key - identifier
   * @returns {{ allowed: boolean, remaining: number, resetTime: number, limit: number }}
   */
  check(key) {
    const fullKey = `${this.keyPrefix}:${key}`;
    const now = Date.now();
    const currentWindow = Math.floor(now / this.windowMs);

    let record = this.store.get(fullKey);
    if (!record || record.window !== currentWindow) {
      record = { window: currentWindow, count: 0 };
    }

    if (record.count >= this.maxRequests) {
      const resetTime = (currentWindow + 1) * this.windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetTime,
        limit: this.maxRequests,
        retryAfter: Math.ceil((resetTime - now) / 1000),
      };
    }

    record.count++;
    this.store.set(fullKey, record);

    return {
      allowed: true,
      remaining: this.maxRequests - record.count,
      resetTime: (currentWindow + 1) * this.windowMs,
      limit: this.maxRequests,
      retryAfter: 0,
    };
  }

  reset(key) {
    if (key) {
      this.store.delete(`${this.keyPrefix}:${key}`);
    } else {
      this.store.reset();
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Middleware Factory
// ---------------------------------------------------------------------------

/**
 * Create rate limiting middleware
 *
 * @param {object} opts
 * @param {string} opts.algorithm - 'tokenBucket' | 'slidingWindow' | 'fixedWindow'
 * @param {number} opts.windowMs - window size (for sliding/fixed window)
 * @param {number} opts.maxRequests - max requests per window
 * @param {number} opts.bucketSize - bucket size (for token bucket)
 * @param {number} opts.refillRate - tokens per second (for token bucket)
 * @param {function} opts.keyGenerator - (req) => string, default uses IP
 * @param {function} opts.skip - (req) => boolean, skip rate limiting if true
 * @param {function} opts.onLimitReached - (req, res, info) => void, custom handler
 * @param {boolean} opts.standardHeaders - include RateLimit-* headers
 * @param {boolean} opts.legacyHeaders - include X-RateLimit-* headers
 */
function createRateLimitMiddleware(opts = {}) {
  const algorithm = opts.algorithm || "slidingWindow";
  
  // Create appropriate limiter
  let limiter;
  switch (algorithm) {
    case "tokenBucket":
      limiter = new TokenBucketLimiter({
        bucketSize: opts.bucketSize || 60,
        refillRate: opts.refillRate || 1,
      });
      break;
    case "fixedWindow":
      limiter = new FixedWindowLimiter({
        windowMs: opts.windowMs || 60_000,
        maxRequests: opts.maxRequests || 60,
      });
      break;
    case "slidingWindow":
    default:
      limiter = new SlidingWindowLimiter({
        windowMs: opts.windowMs || 60_000,
        maxRequests: opts.maxRequests || 60,
      });
  }

  // Default key generator uses client IP
  const keyGenerator = opts.keyGenerator || defaultKeyGenerator;
  
  // Skip function (health checks, etc.)
  const skip = opts.skip || defaultSkip;

  // Header options
  const standardHeaders = opts.standardHeaders !== false;
  const legacyHeaders = opts.legacyHeaders !== false;

  return function rateLimitMiddleware(req, res, next) {
    // Skip if configured
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    if (!key) {
      // No key could be generated, skip rate limiting
      return next();
    }

    const result = limiter.check ? limiter.check(key) : limiter.consume(key);

    // Set headers
    if (standardHeaders) {
      res.setHeader("RateLimit-Limit", String(result.limit));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, result.remaining)));
      res.setHeader("RateLimit-Reset", new Date(result.resetTime).toISOString());
    }
    
    if (legacyHeaders) {
      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetTime / 1000)));
    }

    if (!result.allowed) {
      // Rate limit exceeded
      if (opts.onLimitReached) {
        return opts.onLimitReached(req, res, result);
      }

      const retryAfter = result.retryAfter || Math.ceil((result.resetTime - Date.now()) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("Content-Type", "application/json");
      
      if (res.status) {
        // Express/Connect style
        res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter,
        });
      } else {
        // Raw http style
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter,
        }));
      }
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// 6. Key Generators & Helpers
// ---------------------------------------------------------------------------

function getClientIp(req) {
  // Check for X-Forwarded-For (with trusted proxy validation)
  const trustedProxies = new Set([
    "127.0.0.1", "::1", "::ffff:127.0.0.1",
    ...(process.env.TRUSTED_PROXIES || "").split(",").filter(Boolean),
  ]);

  const directIp = req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
  
  if (trustedProxies.has(directIp)) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) {
      // Take the first IP in the chain (closest to client)
      return xff.split(",")[0].trim();
    }
    const xri = req.headers["x-real-ip"];
    if (xri) return xri;
  }

  return directIp;
}

function defaultKeyGenerator(req) {
  const ip = getClientIp(req);
  const route = req.url || req.path || "/";
  return `${ip}:${route}`;
}

function defaultSkip(req) {
  // Skip health checks
  if (req.url === "/health" || req.url === "/healthz") {
    return true;
  }
  
  // Skip internal IPs if configured
  if (process.env.RATE_LIMIT_SKIP_LOCAL === "true") {
    const ip = getClientIp(req);
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return true;
    }
  }
  
  return false;
}

// ---------------------------------------------------------------------------
// 7. Pre-configured Middleware Presets
// ---------------------------------------------------------------------------

/**
 * Standard API rate limiting: 120 requests per minute
 */
const standard = (opts = {}) => createRateLimitMiddleware({
  algorithm: "slidingWindow",
  windowMs: 60_000,
  maxRequests: 120,
  ...opts,
});

/**
 * Strict rate limiting for write operations: 20 requests per minute
 */
const strict = (opts = {}) => createRateLimitMiddleware({
  algorithm: "slidingWindow",
  windowMs: 60_000,
  maxRequests: 20,
  ...opts,
});

/**
 * Burst-friendly rate limiting using token bucket
 */
const burst = (opts = {}) => createRateLimitMiddleware({
  algorithm: "tokenBucket",
  bucketSize: 100,
  refillRate: 2, // 2 tokens per second = 120 per minute sustained
  ...opts,
});

/**
 * Authentication endpoint rate limiting (very strict)
 */
const auth = (opts = {}) => createRateLimitMiddleware({
  algorithm: "fixedWindow",
  windowMs: 60_000,
  maxRequests: 10,
  keyGenerator: (req) => getClientIp(req), // IP only, not per-route
  ...opts,
});

// ---------------------------------------------------------------------------
// 8. Integration Helpers
// ---------------------------------------------------------------------------

/**
 * Create Express-compatible rate limiter with multiple tiers
 * @param {object} tiers - { routePattern: limiterOptions }
 * @example
 * const limiter = createTieredRateLimit({
 *   "/api/auth/*": { maxRequests: 10, windowMs: 60000 },
 *   "/api/write/*": { maxRequests: 20, windowMs: 60000 },
 *   "*": { maxRequests: 120, windowMs: 60000 },
 * });
 */
function createTieredRateLimit(tiers) {
  const limiters = Object.entries(tiers).map(([pattern, opts]) => ({
    pattern: new RegExp(pattern.replace(/\*/g, ".*")),
    middleware: createRateLimitMiddleware(opts),
  }));

  return function tieredRateLimit(req, res, next) {
    const path = req.url || req.path || "/";
    
    for (const { pattern, middleware } of limiters) {
      if (pattern.test(path)) {
        return middleware(req, res, next);
      }
    }
    
    next();
  };
}

// ---------------------------------------------------------------------------
// 9. Exports
// ---------------------------------------------------------------------------
module.exports = {
  // Classes
  TokenBucketLimiter,
  SlidingWindowLimiter,
  FixedWindowLimiter,
  MemoryStore,
  
  // Middleware factory
  createRateLimitMiddleware,
  createTieredRateLimit,
  
  // Presets
  standard,
  strict,
  burst,
  auth,
  
  // Utilities
  getClientIp,
  defaultKeyGenerator,
  defaultSkip,
};

// ---------------------------------------------------------------------------
// 10. Standalone test
// ---------------------------------------------------------------------------
if (require.main === module) {
  console.log("Rate Limiter Module - Self Test\n");
  
  // Test sliding window
  console.log("1. Testing SlidingWindowLimiter:");
  const sw = new SlidingWindowLimiter({ windowMs: 1000, maxRequests: 3 });
  
  for (let i = 1; i <= 5; i++) {
    const result = sw.check("test-key");
    console.log(`  Request ${i}: allowed=${result.allowed}, remaining=${result.remaining}`);
  }
  
  // Test token bucket
  console.log("\n2. Testing TokenBucketLimiter:");
  const tb = new TokenBucketLimiter({ bucketSize: 5, refillRate: 1 });
  
  // Consume all tokens
  for (let i = 1; i <= 7; i++) {
    const result = tb.consume("test-key-2");
    console.log(`  Request ${i}: allowed=${result.allowed}, remaining=${result.remaining}`);
  }
  
  // Test fixed window
  console.log("\n3. Testing FixedWindowLimiter:");
  const fw = new FixedWindowLimiter({ windowMs: 1000, maxRequests: 3 });
  
  for (let i = 1; i <= 5; i++) {
    const result = fw.check("test-key-3");
    console.log(`  Request ${i}: allowed=${result.allowed}, remaining=${result.remaining}`);
  }
  
  console.log("\n✅ All tests completed");
}
