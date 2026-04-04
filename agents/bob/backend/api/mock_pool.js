/**
 * Mock PostgreSQL pool for MOCK_MODE integration testing.
 * Returns realistic data so frontend/dashboard developers can test without a DB.
 */

"use strict";

const MOCK_MARKETS = [
  {
    id: "m1",
    ticker: "INXW-25-DEC31",
    title: "S&P 500 to close above 5000",
    category: "Economics",
    status: "active",
    yes_bid: 85,
    yes_ask: 87,
    yes_mid: 86,
    no_bid: 13,
    no_ask: 15,
    no_mid: 14,
    volume: 250000,
    open_interest: 12000,
    price_updated_at: new Date().toISOString(),
  },
  {
    id: "m2",
    ticker: "BTCW-25-DEC31",
    title: "Bitcoin above 100k",
    category: "Crypto",
    status: "active",
    yes_bid: 15,
    yes_ask: 17,
    yes_mid: 16,
    no_bid: 83,
    no_ask: 85,
    no_mid: 84,
    volume: 180000,
    open_interest: 8000,
    price_updated_at: new Date().toISOString(),
  },
  {
    id: "m3",
    ticker: "UNEMP-25-MAR",
    title: "Unemployment below 4%",
    category: "Economics",
    status: "active",
    yes_bid: 55,
    yes_ask: 57,
    yes_mid: 56,
    no_bid: 43,
    no_ask: 45,
    no_mid: 44,
    volume: 90000,
    open_interest: 5000,
    price_updated_at: new Date().toISOString(),
  },
  {
    id: "m4",
    ticker: "KXNF-260501-T100000",
    title: "NFP above 100,000 (May 2026)",
    category: "Economics",
    status: "active",
    yes_bid: 64,
    yes_ask: 68,
    yes_mid: 66,
    no_bid: 32,
    no_ask: 36,
    no_mid: 34,
    volume: 150000,
    open_interest: 50000,
    price_updated_at: new Date().toISOString(),
  },
  {
    id: "m5",
    ticker: "KXNF-260501-T150000",
    title: "NFP above 150,000 (May 2026)",
    category: "Economics",
    status: "active",
    yes_bid: 39,
    yes_ask: 43,
    yes_mid: 41,
    no_bid: 57,
    no_ask: 61,
    no_mid: 59,
    volume: 200000,
    open_interest: 75000,
    price_updated_at: new Date().toISOString(),
  },
  {
    id: "m6",
    ticker: "KXNF-260501-T200000",
    title: "NFP above 200,000 (May 2026)",
    category: "Economics",
    status: "active",
    yes_bid: 19,
    yes_ask: 23,
    yes_mid: 21,
    no_bid: 77,
    no_ask: 81,
    no_mid: 79,
    volume: 180000,
    open_interest: 60000,
    price_updated_at: new Date().toISOString(),
  },
];

const MOCK_STRATEGIES = [
  {
    id: "s1",
    name: "Momentum Hunter",
    description: "Identifies markets with strong price momentum and volume spikes",
    strategy_type: "momentum",
    status: "active",
    total_trades: 45,
    winning_trades: 31,
    losing_trades: 14,
    total_pnl: 24550,
    signal_strength: 0.78,
    trades_today: 12,
    win_rate: 0.6889,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "s2",
    name: "Mean Reversion",
    description: "Targets overbought/oversold markets based on price deviations",
    strategy_type: "mean_reversion",
    status: "active",
    total_trades: 22,
    winning_trades: 12,
    losing_trades: 10,
    total_pnl: 8920,
    signal_strength: 0.45,
    trades_today: 5,
    win_rate: 0.5455,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "s3",
    name: "News Sentiment",
    description: "Reacts to breaking news and sentiment shifts in real-time",
    strategy_type: "momentum",
    status: "paused",
    total_trades: 18,
    winning_trades: 7,
    losing_trades: 11,
    total_pnl: -3480,
    signal_strength: 0.23,
    trades_today: 0,
    win_rate: 0.3889,
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "s4",
    name: "NFP Nowcast",
    description: "Nowcasting model for Non-Farm Payroll releases",
    strategy_type: "nfp_nowcast",
    status: "active",
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    total_pnl: 0,
    signal_strength: 0.0,
    trades_today: 0,
    win_rate: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const MOCK_SIGNALS = [
  {
    id: "sig1",
    strategy_id: "s1",
    market_id: "m1",
    side: "yes",
    signal_type: "entry",
    confidence: 0.82,
    target_price: 86,
    current_price: 86,
    expected_edge: 8,
    recommended_contracts: 25,
    reason: "Strong momentum in Economics category",
    acted_on: false,
    generated_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "sig2",
    strategy_id: "s2",
    market_id: "m2",
    side: "no",
    signal_type: "entry",
    confidence: 0.71,
    target_price: 16,
    current_price: 16,
    expected_edge: 12,
    recommended_contracts: 15,
    reason: "Overbought conditions detected",
    acted_on: true,
    generated_at: new Date(Date.now() - 7200000).toISOString(),
  },
];

const MOCK_PERFORMANCE = Array.from({ length: 14 }).map((_, i) => ({
  id: `perf-${i}`,
  strategy_id: "s1",
  period: "daily",
  period_start: new Date(Date.now() - (13 - i) * 86400000).toISOString(),
  trades_count: Math.floor(Math.random() * 10),
  realized_pnl: Math.floor(Math.random() * 2000 - 500),
  unrealized_pnl: Math.floor(Math.random() * 1000 - 200),
  total_pnl: 0,
  win_rate: 0.5 + Math.random() * 0.3,
  cumulative_pnl: 0,
}));

// Compute cumulative P&L
let cum = 0;
for (const p of MOCK_PERFORMANCE) {
  cum += p.realized_pnl;
  p.total_pnl = p.realized_pnl + p.unrealized_pnl;
  p.cumulative_pnl = cum;
}

const MOCK_ORDERS = [];

function matchSql(sql) {
  const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized;
}

class MockClient {
  async query(sql, params = []) {
    const q = matchSql(sql);

    if (q === "begin") return { rows: [] };
    if (q === "commit") return { rows: [] };
    if (q === "rollback") return { rows: [] };

    if (q.includes("select now()")) {
      return { rows: [{ now: new Date().toISOString() }] };
    }

    if (q.includes("from active_markets_with_prices")) {
      let result = [...MOCK_MARKETS];
      if (params.length > 0 && q.includes("ticker =")) {
        result = result.filter((m) => m.ticker === params[0]);
      }
      if (q.includes("category =")) {
        const cat = params[params.length - 1];
        result = result.filter((m) => m.category === cat);
      }
      return { rows: result };
    }

    if (q.includes("from markets where ticker =")) {
      return { rows: MOCK_MARKETS.filter((m) => m.ticker === params[0]) };
    }

    if (q.includes("from price_candles")) {
      return {
        rows: Array.from({ length: 7 }).map((_, i) => ({
          candle_time: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
          yes_close: params[0] === "m1" ? 86 : params[0] === "m2" ? 16 : 56,
          yes_volume: 10000 + i * 1000,
        })),
      };
    }

    if (q.includes("from portfolio_snapshots")) {
      return {
        rows: [
          {
            balance: 500000,
            portfolio_value: 24550,
            total_value: 524550,
            daily_pnl: 1250,
          },
        ],
      };
    }

    if (q.includes("from positions where status = 'open'")) {
      return { rows: [{ count: 2, yes_contracts: 100, no_contracts: 50 }] };
    }

    if (q.includes("from open_positions_with_markets")) {
      return { rows: [] };
    }

    if (q.includes("from orders")) {
      if (q.includes("where o.id =")) {
        const order = MOCK_ORDERS.find((o) => o.id === params[0]);
        return { rows: order ? [order] : [] };
      }
      return { rows: MOCK_ORDERS };
    }

    if (q.includes("insert into orders")) {
      const order = {
        id: `ord-${Date.now()}`,
        market_id: params[0],
        side: params[1],
        action: params[2],
        contracts: params[3],
        price: params[4],
        status: params[5],
        client_order_id: params[6],
        created_at: new Date().toISOString(),
      };
      MOCK_ORDERS.push(order);
      return { rows: [order] };
    }

    if (q.includes("update orders")) {
      const order = MOCK_ORDERS.find((o) => o.id === params[0]);
      if (order) {
        order.status = "cancelled";
        order.updated_at = new Date().toISOString();
      }
      return { rows: order ? [order] : [] };
    }

    if (q.includes("from strategies where status = 'active'")) {
      return { rows: MOCK_STRATEGIES.filter((s) => s.status === "active") };
    }

    if (q.includes("from strategies where id =")) {
      return { rows: MOCK_STRATEGIES.filter((s) => s.id === params[0]) };
    }

    if (q.includes("from strategies")) {
      return { rows: MOCK_STRATEGIES.map((s) => ({ id: s.id })) };
    }

    if (q.includes("from strategy_summary_view")) {
      if (params.length > 0) {
        return { rows: MOCK_STRATEGIES.filter((s) => s.id === params[0]) };
      }
      return { rows: MOCK_STRATEGIES };
    }

    if (q.includes("from strategy_signals")) {
      let result = MOCK_SIGNALS.filter((s) => s.strategy_id === params[0]);
      return { rows: result };
    }

    if (q.includes("from strategy_positions_view")) {
      if (q.includes("sum(calculated_unrealized_pnl)")) {
        return { rows: [{ total_unrealized_pnl: 0 }] };
      }
      return { rows: [{ unrealized_pnl: 0 }] };
    }

    if (q.includes("from strategy_trades")) {
      const strategyId = params[0];
      const strategy = MOCK_STRATEGIES.find((s) => s.id === strategyId);
      if (q.includes("count(*)")) {
        if (q.includes("attributed_pnl is not null")) {
          return {
            rows: [{
              total_trades: strategy ? strategy.total_trades : 0,
              winning_trades: strategy ? strategy.winning_trades : 0,
              losing_trades: strategy ? strategy.losing_trades : 0,
            }],
          };
        }
        return { rows: [{ trades_today: strategy ? strategy.trades_today : 0 }] };
      }
      if (q.includes("sum(attributed_pnl)")) {
        return { rows: [{ realized_pnl: strategy ? strategy.total_pnl : 0 }] };
      }
      return { rows: [{ total_trades: 0, winning_trades: 0, losing_trades: 0 }] };
    }

    if (q.includes("from strategy_performance")) {
      return { rows: MOCK_PERFORMANCE };
    }

    if (q.includes("insert into strategies")) {
      const strategy = {
        id: `s-${Date.now()}`,
        name: params[0],
        description: params[1],
        strategy_type: params[2],
        config: params[3],
        status: params[4],
        max_position_size: params[5],
        max_daily_loss: params[6],
        max_exposure: params[7],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      MOCK_STRATEGIES.push(strategy);
      return { rows: [strategy] };
    }

    if (q.includes("update strategies set")) {
      // Simplified: find by last param
      const id = params[params.length - 1];
      const strategy = MOCK_STRATEGIES.find((s) => s.id === id);
      if (strategy && params.length > 1) {
        if (params[0] === "active" || params[0] === "paused" || params[0] === "stopped") {
          strategy.status = params[0];
        }
        strategy.updated_at = new Date().toISOString();
      }
      return { rows: strategy ? [strategy] : [] };
    }

    if (q.includes("insert into strategy_signals")) {
      return { rows: [] };
    }

    // Default fallback
    return { rows: [] };
  }

  release() {}

  async queryBegin() {}
  async queryCommit() {}
  async queryRollback() {}
}

class MockPool {
  async connect() {
    const client = new MockClient();
    client.queryBegin = async () => {};
    client.queryCommit = async () => {};
    client.queryRollback = async () => {};
    client.query = client.query.bind(client);
    return client;
  }
  end() {}
}

module.exports = { MockPool };
