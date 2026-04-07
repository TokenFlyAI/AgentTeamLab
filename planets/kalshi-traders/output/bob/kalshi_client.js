/**
 * Kalshi REST API Client Module
 *
 * Supports real Kalshi API v2 (trading-api.kalshi.com) and mock mode for testing.
 * Set KALSHI_API_KEY env var for real mode. Without it, falls back to mock mode.
 *
 * Usage:
 *   const { KalshiClient } = require('./kalshi_client');
 *   const client = new KalshiClient(); // auto-detects mock vs real
 *   await client.login();
 *   const markets = await client.getMarkets({ status: 'open', limit: 50 });
 */

const https = require('https');
const crypto = require('crypto');

const KALSHI_API_BASE = 'https://trading-api.kalshi.com/trade-api/v2';
const KALSHI_DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

class KalshiClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.KALSHI_API_KEY || null;
    this.apiSecret = options.apiSecret || process.env.KALSHI_API_SECRET || null;
    this.email = options.email || process.env.KALSHI_EMAIL || null;
    this.password = options.password || process.env.KALSHI_PASSWORD || null;
    this.useDemo = options.demo || process.env.KALSHI_DEMO === 'true' || false;
    this.mockMode = options.mock || (!this.apiKey && !this.email);
    this.baseUrl = this.useDemo ? KALSHI_DEMO_BASE : KALSHI_API_BASE;
    this.sessionToken = null;
    this.memberId = null;

    if (this.mockMode) {
      console.log('[KalshiClient] Mock mode — no credentials found. Using synthetic data.');
    } else {
      const authMethod = this.apiKey ? 'API key' : 'email/password';
      const env = this.useDemo ? 'DEMO' : 'PRODUCTION';
      console.log(`[KalshiClient] Real mode (${env}) — auth via ${authMethod}.`);
    }
  }

  // --- Authentication ---

  async login() {
    if (this.mockMode) {
      this.sessionToken = 'mock-session-token';
      this.memberId = 'mock-member-id';
      return { token: this.sessionToken, member_id: this.memberId };
    }

    if (this.apiKey) {
      // API key auth — no login needed, just set headers
      this.sessionToken = this.apiKey;
      return { token: '[api-key-auth]', member_id: 'api-key-user' };
    }

    // Email/password login
    const body = { email: this.email, password: this.password };
    const resp = await this._request('POST', '/login', body);
    this.sessionToken = resp.token;
    this.memberId = resp.member_id;
    return resp;
  }

  async logout() {
    if (this.mockMode) {
      this.sessionToken = null;
      return { ok: true };
    }
    const resp = await this._request('POST', '/logout');
    this.sessionToken = null;
    return resp;
  }

  // --- Markets ---

  async getMarkets(params = {}) {
    if (this.mockMode) return this._mockMarkets(params);

    const query = this._buildQuery({
      limit: params.limit || 100,
      cursor: params.cursor || undefined,
      status: params.status || 'open',
      series_ticker: params.series_ticker || undefined,
      event_ticker: params.event_ticker || undefined,
    });
    const resp = await this._request('GET', `/markets${query}`);
    return resp;
  }

  async getMarket(ticker) {
    if (this.mockMode) return this._mockMarket(ticker);
    return this._request('GET', `/markets/${ticker}`);
  }

  async getEvent(eventTicker) {
    if (this.mockMode) return { event: { event_ticker: eventTicker, title: `Mock Event ${eventTicker}`, markets: [] } };
    return this._request('GET', `/events/${eventTicker}`);
  }

  // --- Order Book ---

  async getOrderBook(ticker, params = {}) {
    if (this.mockMode) return this._mockOrderBook(ticker);

    const query = this._buildQuery({ depth: params.depth || 10 });
    return this._request('GET', `/markets/${ticker}/orderbook${query}`);
  }

  // --- Candles / History ---

  async getCandles(ticker, params = {}) {
    if (this.mockMode) return this._mockCandles(ticker, params);

    const query = this._buildQuery({
      series_ticker: ticker,
      period_interval: params.interval || 60, // minutes
      start_ts: params.start_ts || undefined,
      end_ts: params.end_ts || undefined,
    });
    return this._request('GET', `/series/${ticker}/markets${query}`);
  }

  async getMarketHistory(ticker, params = {}) {
    if (this.mockMode) return this._mockMarketHistory(ticker, params);

    const query = this._buildQuery({
      limit: params.limit || 100,
      cursor: params.cursor || undefined,
      min_ts: params.min_ts || undefined,
      max_ts: params.max_ts || undefined,
    });
    return this._request('GET', `/markets/${ticker}/history${query}`);
  }

  // --- Trading (Paper / Live) ---

  async createOrder(params) {
    if (this.mockMode) return this._mockCreateOrder(params);

    const body = {
      ticker: params.ticker,
      action: params.action, // 'buy' or 'sell'
      side: params.side, // 'yes' or 'no'
      type: params.type || 'limit',
      count: params.count,
      ...(params.type !== 'market' && { yes_price: params.yes_price, no_price: params.no_price }),
      expiration_ts: params.expiration_ts || undefined,
      sell_position_floor: params.sell_position_floor || undefined,
      buy_max_cost: params.buy_max_cost || undefined,
    };
    return this._request('POST', '/portfolio/orders', body);
  }

  async cancelOrder(orderId) {
    if (this.mockMode) return { order: { order_id: orderId, status: 'canceled' } };
    return this._request('DELETE', `/portfolio/orders/${orderId}`);
  }

  async getOrder(orderId) {
    if (this.mockMode) return { order: { order_id: orderId, status: 'resting', ticker: 'MOCK-TICKER' } };
    return this._request('GET', `/portfolio/orders/${orderId}`);
  }

  async getOrders(params = {}) {
    if (this.mockMode) return { orders: [], cursor: null };
    const query = this._buildQuery({
      ticker: params.ticker || undefined,
      status: params.status || undefined,
      limit: params.limit || 100,
    });
    return this._request('GET', `/portfolio/orders${query}`);
  }

  // --- Portfolio ---

  async getPositions(params = {}) {
    if (this.mockMode) return { market_positions: [] };
    const query = this._buildQuery({
      limit: params.limit || 100,
      settlement_status: params.settlement_status || undefined,
      ticker: params.ticker || undefined,
    });
    return this._request('GET', `/portfolio/positions${query}`);
  }

  async getBalance() {
    if (this.mockMode) return { balance: 10000_00 }; // $10,000.00 in cents
    return this._request('GET', '/portfolio/balance');
  }

  async getFills(params = {}) {
    if (this.mockMode) return { fills: [], cursor: null };
    const query = this._buildQuery({
      ticker: params.ticker || undefined,
      limit: params.limit || 100,
    });
    return this._request('GET', `/portfolio/fills${query}`);
  }

  // --- HTTP Layer ---

  async _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      };

      // Auth header
      if (this.apiKey && !path.includes('/login')) {
        // RSA-signed API key auth (Kalshi v2)
        const timestamp = Math.floor(Date.now() / 1000).toString();
        options.headers['KALSHI-ACCESS-KEY'] = this.apiKey;
        options.headers['KALSHI-ACCESS-TIMESTAMP'] = timestamp;
        if (this.apiSecret) {
          const sigPayload = timestamp + method + path;
          options.headers['KALSHI-ACCESS-SIGNATURE'] = this._sign(sigPayload);
        }
      } else if (this.sessionToken && !path.includes('/login')) {
        options.headers['Authorization'] = `Bearer ${this.sessionToken}`;
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const err = new Error(`Kalshi API ${res.statusCode}: ${parsed.message || data}`);
              err.statusCode = res.statusCode;
              err.response = parsed;
              reject(err);
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Kalshi response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Kalshi API request timeout (15s)'));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  _sign(payload) {
    if (!this.apiSecret) return '';
    try {
      const key = crypto.createPrivateKey(this.apiSecret);
      const sig = crypto.sign('RSA-SHA256', Buffer.from(payload), key);
      return sig.toString('base64');
    } catch (e) {
      console.error('[KalshiClient] Signing failed:', e.message);
      return '';
    }
  }

  _buildQuery(params) {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return '';
    return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }

  // --- Mock Data Generators ---

  _mockMarkets(params) {
    const tickers = [
      { ticker: 'KXBTC-25APR-100K', title: 'Bitcoin above $100K by April 2025?', yes_bid: 42, yes_ask: 44, volume: 25000 },
      { ticker: 'KXETH-25APR-5K', title: 'Ethereum above $5K by April 2025?', yes_bid: 25, yes_ask: 28, volume: 18000 },
      { ticker: 'KXFED-25MAY-HOLD', title: 'Fed holds rates in May 2025?', yes_bid: 72, yes_ask: 75, volume: 32000 },
      { ticker: 'KXGDP-25Q2-3PCT', title: 'GDP growth above 3% in Q2 2025?', yes_bid: 18, yes_ask: 22, volume: 15000 },
      { ticker: 'KXCPI-25APR-LT3', title: 'CPI under 3% in April 2025?', yes_bid: 68, yes_ask: 71, volume: 22000 },
      { ticker: 'KXSNP-25APR-5500', title: 'S&P 500 above 5500 by end of April?', yes_bid: 55, yes_ask: 58, volume: 28000 },
      { ticker: 'KXTSLA-25Q2-200', title: 'Tesla above $200 in Q2 2025?', yes_bid: 35, yes_ask: 38, volume: 12000 },
      { ticker: 'KXRAIN-25APR-NYC', title: 'Rain in NYC on April 15 2025?', yes_bid: 60, yes_ask: 63, volume: 8000 },
    ];

    const limit = params.limit || 100;
    return {
      markets: tickers.slice(0, limit).map(t => ({
        ticker: t.ticker,
        event_ticker: t.ticker.split('-').slice(0, 2).join('-'),
        title: t.title,
        status: 'open',
        yes_bid: t.yes_bid,
        yes_ask: t.yes_ask,
        no_bid: 100 - t.yes_ask,
        no_ask: 100 - t.yes_bid,
        volume: t.volume,
        open_interest: Math.floor(t.volume * 0.4),
        last_price: Math.floor((t.yes_bid + t.yes_ask) / 2),
      })),
      cursor: null,
    };
  }

  _mockMarket(ticker) {
    const mkt = this._mockMarkets({}).markets.find(m => m.ticker === ticker);
    if (mkt) return { market: mkt };
    return {
      market: {
        ticker,
        title: `Mock market ${ticker}`,
        status: 'open',
        yes_bid: 50,
        yes_ask: 53,
        no_bid: 47,
        no_ask: 50,
        volume: 10000,
        open_interest: 4000,
        last_price: 51,
      },
    };
  }

  _mockOrderBook(ticker) {
    const midYes = 50;
    return {
      orderbook: {
        ticker,
        yes: Array.from({ length: 5 }, (_, i) => ({
          price: midYes - i - 1,
          quantity: Math.floor(Math.random() * 500) + 100,
        })),
        no: Array.from({ length: 5 }, (_, i) => ({
          price: (100 - midYes) - i - 1,
          quantity: Math.floor(Math.random() * 500) + 100,
        })),
      },
    };
  }

  _mockCandles(ticker, params) {
    const count = 30;
    const now = Math.floor(Date.now() / 1000);
    const interval = (params.interval || 60) * 60; // seconds
    return {
      candles: Array.from({ length: count }, (_, i) => {
        const base = 45 + Math.random() * 10;
        return {
          ts: now - (count - i) * interval,
          open: Math.round(base),
          high: Math.round(base + Math.random() * 3),
          low: Math.round(base - Math.random() * 3),
          close: Math.round(base + (Math.random() - 0.5) * 4),
          volume: Math.floor(Math.random() * 1000) + 200,
        };
      }),
    };
  }

  _mockMarketHistory(ticker, params) {
    const count = params.limit || 30;
    const now = Math.floor(Date.now() / 1000);
    return {
      history: Array.from({ length: count }, (_, i) => ({
        ts: now - (count - i) * 3600,
        yes_price: Math.round(45 + Math.random() * 10),
        volume: Math.floor(Math.random() * 500) + 50,
        open_interest: Math.floor(Math.random() * 5000) + 1000,
      })),
      cursor: null,
    };
  }

  _mockCreateOrder(params) {
    const orderId = 'mock-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return {
      order: {
        order_id: orderId,
        ticker: params.ticker,
        action: params.action,
        side: params.side,
        type: params.type || 'limit',
        count: params.count,
        yes_price: params.yes_price || 50,
        status: params.type === 'market' ? 'executed' : 'resting',
        created_time: new Date().toISOString(),
        ...(params.type === 'market' && {
          avg_fill_price: params.yes_price || 50,
          filled_count: params.count,
        }),
      },
    };
  }
}

// --- CLI Test ---
if (require.main === module) {
  (async () => {
    console.log('=== Kalshi Client Test ===\n');
    const client = new KalshiClient({ mock: true });

    // Auth
    const auth = await client.login();
    console.log('Login:', auth.token ? 'OK' : 'FAIL');

    // Markets
    const markets = await client.getMarkets({ limit: 5 });
    console.log(`\nMarkets (${markets.markets.length}):`);
    markets.markets.forEach(m => {
      console.log(`  ${m.ticker}: ${m.title} — yes ${m.yes_bid}/${m.yes_ask}, vol ${m.volume}`);
    });

    // Single market
    const mkt = await client.getMarket('KXBTC-25APR-100K');
    console.log(`\nSingle market: ${mkt.market.ticker} — ${mkt.market.title}`);

    // Order book
    const ob = await client.getOrderBook('KXBTC-25APR-100K');
    console.log(`\nOrder book (${ob.orderbook.ticker}): ${ob.orderbook.yes.length} yes levels, ${ob.orderbook.no.length} no levels`);

    // Candles
    const candles = await client.getCandles('KXBTC-25APR', { interval: 60 });
    console.log(`\nCandles: ${candles.candles.length} bars`);
    console.log(`  Latest: O=${candles.candles.at(-1).open} H=${candles.candles.at(-1).high} L=${candles.candles.at(-1).low} C=${candles.candles.at(-1).close}`);

    // Market history
    const hist = await client.getMarketHistory('KXBTC-25APR-100K', { limit: 5 });
    console.log(`\nHistory: ${hist.history.length} points`);

    // Balance
    const bal = await client.getBalance();
    console.log(`\nBalance: $${(bal.balance / 100).toFixed(2)}`);

    // Place order
    const order = await client.createOrder({
      ticker: 'KXBTC-25APR-100K',
      action: 'buy',
      side: 'yes',
      type: 'limit',
      count: 10,
      yes_price: 43,
    });
    console.log(`\nOrder placed: ${order.order.order_id} — ${order.order.status}`);

    // Market order
    const mktOrder = await client.createOrder({
      ticker: 'KXFED-25MAY-HOLD',
      action: 'buy',
      side: 'yes',
      type: 'market',
      count: 5,
      yes_price: 74,
    });
    console.log(`Market order: ${mktOrder.order.order_id} — filled ${mktOrder.order.filled_count} @ ${mktOrder.order.avg_fill_price}`);

    // Cancel
    const cancel = await client.cancelOrder(order.order.order_id);
    console.log(`Cancel: ${cancel.order.status}`);

    // Positions
    const pos = await client.getPositions();
    console.log(`\nPositions: ${pos.market_positions.length}`);

    // Fills
    const fills = await client.getFills();
    console.log(`Fills: ${fills.fills.length}`);

    console.log('\n=== All tests passed ===');
  })().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
  });
}

module.exports = { KalshiClient, KALSHI_API_BASE, KALSHI_DEMO_BASE };
