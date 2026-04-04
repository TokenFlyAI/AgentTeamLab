/**
 * Kalshi Trading SDK — Consumer API Client
 * Author: Mia (API Engineer)
 * Task: #219 — Clean interface for strategy and research consumers
 *
 * Provides a promise-based JavaScript client for:
 *   - Market data queries
 *   - Price history
 *   - Orderbook
 *   - Portfolio / positions / orders
 *   - Strategy framework integration
 *   - Paper trading
 */

"use strict";

const https = require("https");
const { URL } = require("url");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT = 30000;

// ---------------------------------------------------------------------------
// HTTP Client
// ---------------------------------------------------------------------------

class HttpClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = opts.apiKey || null;
    this.timeout = opts.timeout || DEFAULT_TIMEOUT;
  }

  async request(method, path, opts = {}) {
    const url = new URL(path, this.baseUrl);

    if (opts.params) {
      Object.entries(opts.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : require("http");

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      ...(opts.headers || {}),
    };

    return new Promise((resolve, reject) => {
      const req = lib.request(
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
                  body?.error?.message || body?.error || `HTTP ${res.statusCode}`
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

  get(path, opts) {
    return this.request("GET", path, opts);
  }

  post(path, opts) {
    return this.request("POST", path, opts);
  }

  patch(path, opts) {
    return this.request("PATCH", path, opts);
  }

  delete(path, opts) {
    return this.request("DELETE", path, opts);
  }
}

// ---------------------------------------------------------------------------
// SDK Client
// ---------------------------------------------------------------------------

class KalshiSdk {
  constructor(opts = {}) {
    this.http = new HttpClient(opts);
  }

  // -------------------------------------------------------------------------
  // Markets
  // -------------------------------------------------------------------------

  /**
   * List all active markets with optional filters
   * @param {object} filters
   * @param {string} filters.category
   * @param {string} filters.status
   * @param {number} filters.minVolume
   * @param {string} filters.closingBefore
   */
  async getMarkets(filters = {}) {
    const res = await this.http.get("/api/markets", { params: filters });
    return res.data;
  }

  /**
   * Get a specific market by ticker
   * @param {string} ticker
   */
  async getMarket(ticker) {
    const res = await this.http.get(`/api/markets/${ticker}`);
    return res.data;
  }

  /**
   * Get price history for a market
   * @param {string} ticker
   * @param {object} opts
   * @param {string} opts.resolution - 1m, 5m, 15m, 1h, 1d
   * @param {number} opts.days
   * @param {string} opts.from - ISO 8601
   * @param {string} opts.to - ISO 8601
   */
  async getMarketPrices(ticker, opts = {}) {
    const params = {
      resolution: opts.resolution || "1d",
      ...(opts.days && { days: opts.days }),
      ...(opts.from && { from: opts.from }),
      ...(opts.to && { to: opts.to }),
    };
    const res = await this.http.get(`/api/markets/${ticker}/history`, { params });
    return res.data;
  }

  /**
   * Get current orderbook for a market
   * @param {string} ticker
   * @param {number} depth
   */
  async getOrderbook(ticker, depth = 10) {
    const res = await this.http.get(`/api/markets/${ticker}/orderbook`, {
      params: { depth },
    });
    return res.data;
  }

  // -------------------------------------------------------------------------
  // Portfolio
  // -------------------------------------------------------------------------

  /**
   * Get portfolio summary
   */
  async getPortfolio() {
    const res = await this.http.get("/api/portfolio");
    return res.data;
  }

  /**
   * Get open positions
   * @param {object} opts
   * @param {string} opts.status
   */
  async getPositions(opts = {}) {
    const res = await this.http.get("/api/portfolio/positions", {
      params: opts.status ? { status: opts.status } : {},
    });
    return res.data;
  }

  /**
   * Get orders
   * @param {object} opts
   * @param {string} opts.status
   */
  async getOrders(opts = {}) {
    const params = {};
    if (opts.status) params.status = opts.status;
    const res = await this.http.get("/api/portfolio/orders", { params });
    return res.data;
  }

  // -------------------------------------------------------------------------
  // Trading (Paper)
  // -------------------------------------------------------------------------

  /**
   * Submit a paper trading order
   * @param {object} order
   * @param {string} order.marketId
   * @param {string} order.side - yes | no
   * @param {string} order.action - buy | sell
   * @param {number} order.contracts
   * @param {number} order.price - in cents (0-100)
   * @param {string} [order.clientOrderId]
   */
  async placeOrder(order) {
    const res = await this.http.post("/api/orders", {
      body: {
        marketId: order.marketId,
        side: order.side,
        action: order.action,
        contracts: order.contracts,
        price: order.price,
        clientOrderId: order.clientOrderId || undefined,
      },
    });
    return res.data;
  }

  /**
   * Get order by ID
   * @param {string} orderId
   */
  async getOrder(orderId) {
    const res = await this.http.get(`/api/orders/${orderId}`);
    return res.data;
  }

  /**
   * Cancel an order
   * @param {string} orderId
   */
  async cancelOrder(orderId) {
    const res = await this.http.delete(`/api/orders/${orderId}`);
    return res.data;
  }

  // -------------------------------------------------------------------------
  // Strategies
  // -------------------------------------------------------------------------

  /**
   * List all strategies
   */
  async getStrategies() {
    const res = await this.http.get("/api/strategies");
    return res.data;
  }

  /**
   * Get a strategy by ID
   * @param {string} strategyId
   */
  async getStrategy(strategyId) {
    const res = await this.http.get(`/api/strategies/${strategyId}`);
    return res.data;
  }

  /**
   * Create a new strategy
   * @param {object} strategy
   */
  async createStrategy(strategy) {
    const res = await this.http.post("/api/strategies", { body: strategy });
    return res.data;
  }

  /**
   * Update a strategy
   * @param {string} strategyId
   * @param {object} updates
   */
  async updateStrategy(strategyId, updates) {
    const res = await this.http.patch(`/api/strategies/${strategyId}`, {
      body: updates,
    });
    return res.data;
  }

  /**
   * Run a strategy manually
   * @param {string} strategyId
   */
  async runStrategy(strategyId) {
    const res = await this.http.post(`/api/strategies/${strategyId}/run`);
    return res.data;
  }

  /**
   * Run all active strategies
   */
  async runAllStrategies() {
    const res = await this.http.post("/api/strategies/run-all");
    return res.data;
  }

  /**
   * Get strategy signals
   * @param {string} strategyId
   * @param {object} opts
   */
  async getStrategySignals(strategyId, opts = {}) {
    const params = {};
    if (opts.actedOn !== undefined) params.actedOn = opts.actedOn;
    const res = await this.http.get(`/api/strategies/${strategyId}/signals`, { params });
    return res.data;
  }

  /**
   * Get strategy P&L
   * @param {string} strategyId
   */
  async getStrategyPnl(strategyId) {
    const res = await this.http.get(`/api/strategies/${strategyId}/pnl`);
    return res.data;
  }

  /**
   * Get strategy performance history
   * @param {string} strategyId
   * @param {string} period - hourly, daily, weekly, monthly
   * @param {number} limit
   */
  async getStrategyPerformance(strategyId, period = "daily", limit = 30) {
    const res = await this.http.get(`/api/strategies/${strategyId}/performance`, {
      params: { period, limit },
    });
    return res.data;
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /**
   * Check API health
   */
  async healthCheck() {
    const res = await this.http.get("/health");
    return res.data;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  KalshiSdk,
  HttpClient,
};
