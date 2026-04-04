/**
 * Thin API client wrapper for strategy framework.
 * Talks to Bob's REST API (server.js).
 */

class StrategyClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || process.env.API_BASE_URL || "http://localhost:3000";
    this.apiKey = opts.apiKey || process.env.API_KEY;
  }

  async fetchJson(path, init = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }

  async health() {
    return this.fetchJson("/health");
  }

  async getMarkets(params = {}) {
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    if (params.status) qs.set("status", params.status);
    if (params.minVolume) qs.set("minVolume", String(params.minVolume));
    const data = await this.fetchJson(`/api/markets?${qs.toString()}`);
    return data.markets || [];
  }

  async getMarket(ticker) {
    const data = await this.fetchJson(`/api/markets/${encodeURIComponent(ticker)}`);
    return data.market;
  }

  async getPrices(ticker) {
    const market = await this.getMarket(ticker);
    return {
      marketId: market.id,
      yesBid: market.yes_bid ?? null,
      yesAsk: market.yes_ask ?? null,
      noBid: market.no_bid ?? null,
      noAsk: market.no_ask ?? null,
      yesMid: market.yes_mid ?? null,
      noMid: market.no_mid ?? null,
      impliedProbability: market.implied_probability ?? (market.yes_mid ? market.yes_mid / 100 : null),
      volume: market.volume || 0,
      openInterest: market.open_interest || 0,
      recordedAt: market.price_updated_at || market.recorded_at,
    };
  }

  async getHistory(ticker, params = {}) {
    const qs = new URLSearchParams();
    if (params.resolution) qs.set("resolution", params.resolution);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.days) qs.set("days", String(params.days));
    const data = await this.fetchJson(`/api/markets/${encodeURIComponent(ticker)}/history?${qs.toString()}`);
    return data.data || [];
  }

  async getPortfolio() {
    const data = await this.fetchJson("/api/portfolio");
    const snap = data.snapshot || {};
    return {
      cash: snap.balance || 0,
      totalValue: snap.total_value || snap.portfolio_value || 0,
      dailyPnl: snap.daily_pnl || 0,
    };
  }

  async getPositions() {
    const data = await this.fetchJson("/api/portfolio/positions");
    return data.positions || [];
  }

  async getOrders() {
    const data = await this.fetchJson("/api/portfolio/orders");
    return data.orders || [];
  }

  async submitOrder(order) {
    const data = await this.fetchJson("/api/orders", {
      method: "POST",
      body: JSON.stringify(order),
    });
    return data.order;
  }
}

module.exports = { StrategyClient };
