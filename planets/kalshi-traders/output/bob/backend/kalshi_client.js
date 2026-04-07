/**
 * Kalshi API Client — Agent Planet Trading Infrastructure
 * Author: Bob (Backend Engineer)
 * Task: #219 — Build Kalshi API client to fetch live market data and prices
 *
 * Provides:
 *   - Authentication (API key-based)
 *   - Market data fetching (markets, prices, orderbook)
 *   - Account information
 *   - Order management
 *   - Built-in rate limiting
 *
 * API Docs: https://trading-api.readme.io/reference/getting-started
 */

"use strict";

const https = require("https");
const { URL } = require("url");

// Kalshi API configuration
const KALSHI_API_BASE = "https://trading-api.kalshi.com/v1";
const KALSHI_DEMO_BASE = "https://demo-api.kalshi.com/v1";

// Rate limiting: Kalshi allows 100 requests per 10 seconds per API key
const DEFAULT_RATE_LIMIT = {
  maxRequests: 100,
  windowMs: 10_000,
};

// ---------------------------------------------------------------------------
// Simple In-Memory Rate Limiter (Sliding Window)
// ---------------------------------------------------------------------------
class SimpleRateLimiter {
  constructor(opts = {}) {
    this.maxRequests = opts.maxRequests || DEFAULT_RATE_LIMIT.maxRequests;
    this.windowMs = opts.windowMs || DEFAULT_RATE_LIMIT.windowMs;
    this.requests = [];
  }

  /**
   * Check if a request can be made, wait if necessary
   * @returns {Promise<void>}
   */
  async acquire() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove old requests outside the window
    this.requests = this.requests.filter((t) => t >= windowStart);

    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return;
    }

    // Need to wait
    const oldestRequest = this.requests[0];
    const waitTime = oldestRequest + this.windowMs - now + 10; // +10ms buffer

    if (waitTime > 0) {
      await sleep(waitTime);
    }

    // Recursively try again
    return this.acquire();
  }

  get remaining() {
    const windowStart = Date.now() - this.windowMs;
    this.requests = this.requests.filter((t) => t >= windowStart);
    return Math.max(0, this.maxRequests - this.requests.length);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Kalshi API Client
// ---------------------------------------------------------------------------
class KalshiClient {
  /**
   * Create a new Kalshi API client
   * @param {object} opts
   * @param {string} opts.apiKey - Kalshi API key
   * @param {boolean} opts.demo - Use demo/sandbox environment (default: true)
   * @param {object} opts.rateLimit - Rate limit options
   * @param {number} opts.timeout - Request timeout in ms (default: 30000)
   */
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || process.env.KALSHI_API_KEY;
    this.demo = opts.demo !== false; // Default to demo mode
    this.baseUrl = this.demo ? KALSHI_DEMO_BASE : KALSHI_API_BASE;
    this.timeout = opts.timeout || 30000;

    if (!this.apiKey) {
      throw new Error(
        "Kalshi API key required. Set KALSHI_API_KEY env var or pass apiKey option."
      );
    }

    this.rateLimiter = new SimpleRateLimiter(opts.rateLimit);
  }

  /**
   * Make an authenticated request to the Kalshi API
   * @param {string} method - HTTP method
   * @param {string} path - API path (without base URL)
   * @param {object} opts - Request options
   * @returns {Promise<object>}
   */
  async request(method, path, opts = {}) {
    // Acquire rate limit slot
    await this.rateLimiter.acquire();

    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const baseUrl = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const url = new URL(normalizedPath, baseUrl);

    // Add query params
    if (opts.params) {
      Object.entries(opts.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          headers,
          timeout: this.timeout,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const body = data ? JSON.parse(data) : null;

              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({
                  status: res.statusCode,
                  headers: res.headers,
                  data: body,
                });
              } else {
                const error = new Error(
                  body?.error?.message ||
                    `HTTP ${res.statusCode}: ${res.statusMessage}`
                );
                error.status = res.statusCode;
                error.response = body;
                reject(error);
              }
            } catch (e) {
              reject(new Error(`Failed to parse response: ${e.message}`));
            }
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      if (opts.body) {
        req.write(JSON.stringify(opts.body));
      }

      req.end();
    });
  }

  // -------------------------------------------------------------------------
  // Account Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get account balance and information
   * @returns {Promise<object>}
   */
  async getAccount() {
    return this.request("GET", "/account");
  }

  /**
   * Get account balance
   * @returns {Promise<object>}
   */
  async getBalance() {
    return this.request("GET", "/account/balance");
  }

  // -------------------------------------------------------------------------
  // Market Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get all markets with optional filters
   * @param {object} filters
   * @param {string} filters.status - Market status (active, closed, etc.)
   * @param {string} filters.category - Market category
   * @param {string} filters.series_ticker - Series ticker
   * @param {number} filters.limit - Max results (default: 100)
   * @param {string} filters.cursor - Pagination cursor
   * @returns {Promise<object>}
   */
  async getMarkets(filters = {}) {
    const params = {
      limit: filters.limit || 100,
      ...(filters.status && { status: filters.status }),
      ...(filters.category && { category: filters.category }),
      ...(filters.series_ticker && { series_ticker: filters.series_ticker }),
      ...(filters.cursor && { cursor: filters.cursor }),
    };

    return this.request("GET", "/markets", { params });
  }

  /**
   * Get a specific market by ticker
   * @param {string} ticker - Market ticker symbol
   * @returns {Promise<object>}
   */
  async getMarket(ticker) {
    return this.request("GET", `/markets/${ticker}`);
  }

  /**
   * Get market orderbook
   * @param {string} ticker - Market ticker symbol
   * @param {number} depth - Orderbook depth (default: 10)
   * @returns {Promise<object>}
   */
  async getOrderbook(ticker, depth = 10) {
    return this.request("GET", `/markets/${ticker}/orderbook`, {
      params: { depth },
    });
  }

  /**
   * Get market candle data (price history)
   * @param {string} ticker - Market ticker symbol
   * @param {object} opts
   * @param {string} opts.resolution - Candle resolution (1m, 5m, 15m, 1h, 1d)
   * @param {number} opts.from - Start timestamp (ms)
   * @param {number} opts.to - End timestamp (ms)
   * @returns {Promise<object>}
   */
  async getCandles(ticker, opts = {}) {
    const params = {
      resolution: opts.resolution || "1d",
      ...(opts.from && { from: opts.from }),
      ...(opts.to && { to: opts.to }),
    };

    return this.request("GET", `/markets/${ticker}/candles`, { params });
  }

  /**
   * Get market history (trades)
   * @param {string} ticker - Market ticker symbol
   * @param {object} opts
   * @param {number} opts.limit - Max results
   * @param {string} opts.cursor - Pagination cursor
   * @returns {Promise<object>}
   */
  async getMarketHistory(ticker, opts = {}) {
    const params = {
      limit: opts.limit || 100,
      ...(opts.cursor && { cursor: opts.cursor }),
    };

    return this.request("GET", `/markets/${ticker}/history`, { params });
  }

  // -------------------------------------------------------------------------
  // Series Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get all series
   * @param {object} opts
   * @param {number} opts.limit - Max results
   * @param {string} opts.cursor - Pagination cursor
   * @returns {Promise<object>}
   */
  async getSeries(opts = {}) {
    const params = {
      limit: opts.limit || 100,
      ...(opts.cursor && { cursor: opts.cursor }),
    };

    return this.request("GET", "/series", { params });
  }

  /**
   * Get a specific series
   * @param {string} ticker - Series ticker
   * @returns {Promise<object>}
   */
  async getSeriesByTicker(ticker) {
    return this.request("GET", `/series/${ticker}`);
  }

  // -------------------------------------------------------------------------
  // Event Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get all events
   * @param {object} opts
   * @param {number} opts.limit - Max results
   * @param {string} opts.cursor - Pagination cursor
   * @returns {Promise<object>}
   */
  async getEvents(opts = {}) {
    const params = {
      limit: opts.limit || 100,
      ...(opts.cursor && { cursor: opts.cursor }),
    };

    return this.request("GET", "/events", { params });
  }

  /**
   * Get a specific event
   * @param {string} eventTicker - Event ticker
   * @returns {Promise<object>}
   */
  async getEvent(eventTicker) {
    return this.request("GET", `/events/${eventTicker}`);
  }

  // -------------------------------------------------------------------------
  // Order Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get all orders
   * @param {object} opts
   * @param {string} opts.status - Order status
   * @param {number} opts.limit - Max results
   * @param {string} opts.cursor - Pagination cursor
   * @returns {Promise<object>}
   */
  async getOrders(opts = {}) {
    const params = {
      limit: opts.limit || 100,
      ...(opts.status && { status: opts.status }),
      ...(opts.cursor && { cursor: opts.cursor }),
    };

    return this.request("GET", "/orders", { params });
  }

  /**
   * Get a specific order
   * @param {string} orderId - Order ID
   * @returns {Promise<object>}
   */
  async getOrder(orderId) {
    return this.request("GET", `/orders/${orderId}`);
  }

  /**
   * Create a new order
   * @param {object} order
   * @param {string} order.ticker - Market ticker
   * @param {string} order.side - Order side (yes/no)
   * @param {number} order.count - Number of contracts
   * @param {number} order.price - Price in cents (0-100)
   * @param {string} order.client_order_id - Client order ID (optional)
   * @returns {Promise<object>}
   */
  async createOrder(order) {
    return this.request("POST", "/orders", { body: order });
  }

  /**
   * Cancel an order
   * @param {string} orderId - Order ID
   * @returns {Promise<object>}
   */
  async cancelOrder(orderId) {
    return this.request("DELETE", `/orders/${orderId}`);
  }

  /**
   * Cancel all orders
   * @returns {Promise<object>}
   */
  async cancelAllOrders() {
    return this.request("DELETE", "/orders");
  }

  // -------------------------------------------------------------------------
  // Position Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get all positions
   * @param {object} opts
   * @param {number} opts.limit - Max results
   * @param {string} opts.cursor - Pagination cursor
   * @returns {Promise<object>}
   */
  async getPositions(opts = {}) {
    const params = {
      limit: opts.limit || 100,
      ...(opts.cursor && { cursor: opts.cursor }),
    };

    return this.request("GET", "/positions", { params });
  }

  /**
   * Get a specific position
   * @param {string} ticker - Market ticker
   * @returns {Promise<object>}
   */
  async getPosition(ticker) {
    return this.request("GET", `/positions/${ticker}`);
  }

  // -------------------------------------------------------------------------
  // Portfolio Endpoints
  // -------------------------------------------------------------------------

  /**
   * Get portfolio statistics
   * @returns {Promise<object>}
   */
  async getPortfolio() {
    return this.request("GET", "/portfolio");
  }

  /**
   * Get portfolio history
   * @param {object} opts
   * @param {string} opts.lookback - Lookback period (1d, 7d, 30d, etc.)
   * @returns {Promise<object>}
   */
  async getPortfolioHistory(opts = {}) {
    const params = {
      ...(opts.lookback && { lookback: opts.lookback }),
    };

    return this.request("GET", "/portfolio/history", { params });
  }

  // -------------------------------------------------------------------------
  // Utility Methods
  // -------------------------------------------------------------------------

  /**
   * Get current rate limit status
   * @returns {object}
   */
  getRateLimitStatus() {
    return {
      remaining: this.rateLimiter.remaining,
      limit: this.rateLimiter.maxRequests,
      windowMs: this.rateLimiter.windowMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Create a new Kalshi client from environment variables
 * @returns {KalshiClient}
 */
function createClient() {
  return new KalshiClient({
    apiKey: process.env.KALSHI_API_KEY,
    demo: process.env.KALSHI_DEMO !== "false",
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  KalshiClient,
  SimpleRateLimiter,
  createClient,
};

// ---------------------------------------------------------------------------
// Standalone test
// ---------------------------------------------------------------------------
if (require.main === module) {
  console.log("Kalshi Client Module - Self Test\n");

  // Test rate limiter
  console.log("1. Testing SimpleRateLimiter:");
  const rl = new SimpleRateLimiter({ maxRequests: 3, windowMs: 1000 });

  async function testRateLimiter() {
    for (let i = 1; i <= 5; i++) {
      const start = Date.now();
      await rl.acquire();
      console.log(`  Request ${i}: acquired after ${Date.now() - start}ms`);
    }
  }

  testRateLimiter()
    .then(() => {
      console.log("\n2. Testing KalshiClient instantiation:");

      // Test without API key (should throw)
      try {
        const client = new KalshiClient({});
        console.log("  ERROR: Should have thrown without API key");
      } catch (e) {
        console.log(`  ✓ Correctly throws: ${e.message}`);
      }

      // Test with API key
      const client = new KalshiClient({
        apiKey: "test_key_123",
        demo: true,
      });
      console.log(`  ✓ Client created (demo mode: ${client.demo})`);
      console.log(`  ✓ Base URL: ${client.baseUrl}`);

      // Test rate limit status
      const status = client.getRateLimitStatus();
      console.log(`  ✓ Rate limit: ${status.remaining}/${status.limit}`);

      console.log("\n✅ All tests completed");
    })
    .catch((e) => {
      console.error("\n❌ Test failed:", e.message);
      process.exit(1);
    });
}
