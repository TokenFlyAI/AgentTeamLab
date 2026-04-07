#!/usr/bin/env node
/**
 * Live Strategy Runner — Task 221
 * Connects strategy framework to live Kalshi market data.
 * Author: Bob (Backend Engineer)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { KalshiClient } = require("../kalshi_client");
const { SignalEngine } = require("./signal_engine");
const { PositionSizer } = require("./position_sizer");
const { MeanReversionStrategy } = require("./strategies/mean_reversion");
// DISABLED per T325: momentum and crypto_edge have poor performance (10-11% win rate)
// const { MomentumStrategy } = require("./strategies/momentum");
// const { CryptoEdgeStrategy } = require("./strategies/crypto_edge");
// DISABLED per T325: only mean_reversion enabled for clean 50-trade run
// const { NFPNowcastStrategy } = require("./strategies/nfp_nowcast");
// const { EconEdgeStrategy } = require("./strategies/econ_edge");
const { ExecutionEngine } = require("./execution_engine");
const { RiskManager, getRiskSummary, validateTrade } = require("./risk_manager");
const { getPaperTradesDB } = require("../paper_trades_db");
const { runSettlement } = require("../paper_trade_settlement");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const USE_MOCK_FALLBACK = !process.env.KALSHI_API_KEY;
const MIN_MARKETS = 3;
const CANDLE_DAYS = 10;  // T334 optimized: lookback=10
const OUTPUT_ROOT = path.join(__dirname, "../..");
const OUTPUT_FILE = path.join(OUTPUT_ROOT, "trade_signals.json");
const EXECUTE_TRADES = process.argv.includes("--execute");
const PAPER_TRADING = process.env.PAPER_TRADING !== 'false';
const PAPER_TRADING_INITIAL_CAPITAL_CENTS = parseInt(process.env.PAPER_TRADING_INITIAL_CAPITAL_CENTS || "500000", 10);
const PAPER_TRADING_CAPITAL_FLOOR_CENTS = parseInt(process.env.PAPER_TRADING_CAPITAL_FLOOR_CENTS || "5000", 10);
// T714: Per-trade stop-loss — no single trade should exceed this % of initial capital
const PAPER_TRADING_MAX_TRADE_PCT = parseFloat(process.env.PAPER_TRADING_MAX_TRADE_PCT || "0.20"); // 20%

// Realistic fallback markets when API key is unavailable
const FALLBACK_MARKETS = [
  {
    id: "m1",
    ticker: "INXW-25-DEC31",
    title: "S&P 500 to close above 5000",
    category: "Economics",
    status: "active",
    yes_bid: 85,
    yes_ask: 87,
    no_bid: 13,
    no_ask: 15,
    volume: 250000,
    open_interest: 12000,
  },
  {
    id: "m2",
    ticker: "BTCW-26-JUN30-80K",
    title: "Will Bitcoin exceed $80,000 by June 30, 2026?",
    category: "Crypto",
    status: "active",
    yes_bid: 82,
    yes_ask: 86,
    no_bid: 14,
    no_ask: 18,
    volume: 720000,
    open_interest: 8000,
  },
  {
    id: "m3",
    ticker: "UNEMP-25-MAR",
    title: "Unemployment below 4%",
    category: "Economics",
    status: "active",
    yes_bid: 55,
    yes_ask: 57,
    no_bid: 43,
    no_ask: 45,
    volume: 90000,
    open_interest: 5000,
  },
  {
    id: "m4",
    ticker: "BTCW-26-JUN30-100K",
    title: "Will Bitcoin exceed $100,000 by June 30, 2026?",
    category: "Crypto",
    status: "active",
    yes_bid: 62,
    yes_ask: 66,
    no_bid: 34,
    no_ask: 38,
    volume: 890000,
    open_interest: 12000,
  },
  {
    id: "m5",
    ticker: "ETHW-26-DEC31-5K",
    title: "Will Ethereum exceed $5,000 by December 31, 2026?",
    category: "Crypto",
    status: "active",
    yes_bid: 28,
    yes_ask: 32,
    no_bid: 68,
    no_ask: 72,
    volume: 540000,
    open_interest: 6000,
  },
  {
    id: "m6",
    ticker: "KXNF-20260501-T100000",
    title: "NFP above 100k",
    category: "Financial",
    status: "active",
    yes_bid: 65,
    yes_ask: 67,
    no_bid: 33,
    no_ask: 35,
    volume: 150000,
    open_interest: 50000,
  },
  {
    id: "m7",
    ticker: "KXNF-20260501-T150000",
    title: "NFP above 150k",
    category: "Financial",
    status: "active",
    yes_bid: 50,
    yes_ask: 52,
    no_bid: 48,
    no_ask: 50,
    volume: 200000,
    open_interest: 75000,
  },
  {
    id: "m8",
    ticker: "KXNF-20260501-T200000",
    title: "NFP above 200k",
    category: "Financial",
    status: "active",
    yes_bid: 26,
    yes_ask: 28,
    no_bid: 72,
    no_ask: 74,
    volume: 180000,
    open_interest: 60000,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeMidPrice(bid, ask) {
  if (bid != null && ask != null) return Math.round((bid + ask) / 2);
  if (bid != null) return bid;
  if (ask != null) return ask;
  return 50;
}

function normalizeMarket(m) {
  const yesMid = computeMidPrice(m.yes_bid, m.yes_ask);
  const noMid = computeMidPrice(m.no_bid, m.no_ask);
  return {
    id: m.id || m.ticker,
    ticker: m.ticker,
    title: m.title,
    category: m.category || "Unknown",
    status: m.status || "active",
    yes_bid: m.yes_bid,
    yes_ask: m.yes_ask,
    no_bid: m.no_bid,
    no_ask: m.no_ask,
    yes_mid: yesMid,
    no_mid: noMid,
    volume: m.volume || 0,
    volume24h: m.volume || 0,
    open_interest: m.open_interest || 0,
  };
}

async function fetchMarkets(client) {
  if (USE_MOCK_FALLBACK) {
    console.log("[FALLBACK] No KALSHI_API_KEY set — using realistic mock market data");
    return FALLBACK_MARKETS.map(normalizeMarket);
  }

  const response = await client.getMarkets({ status: "active", limit: 20 });
  const markets = response.data?.markets || [];
  console.log(`Fetched ${markets.length} live markets from Kalshi`);
  return markets.map(normalizeMarket);
}

async function fetchCandles(client, ticker, currentPriceHint) {
  if (USE_MOCK_FALLBACK) {
    // Generate deterministic synthetic candle history (T326 fix)
    // Uses ticker-based seed for reproducible, market-realistic price movement
    // TINA-FIX: Center mock history around current market price to avoid false z-scores
    const fallbackBase = ticker === "BTCW-25-DEC31" ? 16 : ticker === "UNEMP-25-MAR" ? 56 : 86;
    const basePrice = currentPriceHint != null ? currentPriceHint : fallbackBase;
    
    // Create deterministic seed from ticker string
    const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    
    // Deterministic pseudo-random function (seeded)
    const seededRandom = (n) => {
      const x = Math.sin(seed + n) * 10000;
      return x - Math.floor(x);
    };
    
    // Market-realistic drift based on ticker characteristics
    const drift = ((seed % 100) - 50) / 1000; // -5% to +5% trend over the period
    const volatility = 0.02 + (seed % 10) / 1000; // 2-3% daily volatility
    
    let currentPrice = basePrice;
    return Array.from({ length: CANDLE_DAYS }, (_, i) => {
      // Deterministic price movement: trend + noise
      const noise = (seededRandom(i) - 0.5) * 2 * volatility;
      const trend = drift / CANDLE_DAYS;
      const change = trend + noise;
      
      currentPrice = Math.max(1, Math.min(99, currentPrice * (1 + change)));
      
      // Deterministic volume based on ticker and day
      const baseVolume = 10000 + (seed % 5000);
      const volumeVariation = Math.floor(seededRandom(i + 1000) * 5000);
      
      return {
        candle_time: new Date(Date.now() - (CANDLE_DAYS - 1 - i) * 86400000).toISOString(),
        yes_close: Math.round(currentPrice),
        yes_volume: baseVolume + volumeVariation,
      };
    });
  }

  const to = Date.now();
  const from = to - CANDLE_DAYS * 86400000;
  const response = await client.getCandles(ticker, { resolution: "1d", from, to });
  return response.data?.candles || [];
}

function computeHistoryMetrics(candles) {
  if (!candles || candles.length < 2) {
    return { mean: 50, stddev: 10, priceChange: 0 };
  }
  const prices = candles.map((c) => c.yes_close || c.close || 50);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);
  const priceChange = prices[prices.length - 1] - prices[0];
  return { mean, stddev, priceChange };
}

function getCapitalFloorStatus(paperTradesDB) {
  const summary = paperTradesDB.getSummary();
  const realizedPnL = summary.total_pnl || 0;
  const currentCapital = PAPER_TRADING_INITIAL_CAPITAL_CENTS + realizedPnL;

  return {
    initialCapitalCents: PAPER_TRADING_INITIAL_CAPITAL_CENTS,
    floorCents: PAPER_TRADING_CAPITAL_FLOOR_CENTS,
    realizedPnLCents: realizedPnL,
    currentCapitalCents: currentCapital,
    breachAmountCents: Math.max(0, PAPER_TRADING_CAPITAL_FLOOR_CENTS - currentCapital),
    breached: currentCapital < PAPER_TRADING_CAPITAL_FLOOR_CENTS,
    closedTrades: summary.closed_trades || 0,
    openTrades: summary.open_trades || 0,
  };
}

function logCapitalFloorStatus(status, contextLabel) {
  const capitalDollars = (status.currentCapitalCents / 100).toFixed(2);
  const floorDollars = (status.floorCents / 100).toFixed(2);
  const realizedPnLDollars = (status.realizedPnLCents / 100).toFixed(2);
  const prefix = contextLabel ? `${contextLabel}: ` : "";

  console.log(`  ${prefix}Capital: $${capitalDollars} (realized P&L $${realizedPnLDollars}, floor $${floorDollars})`);
  if (status.breached) {
    console.log(`  🛑 Capital floor breached by $${(status.breachAmountCents / 100).toFixed(2)} — halting new trades`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Live Strategy Runner (Task 221) ===\n");

  let client = null;
  if (!USE_MOCK_FALLBACK) {
    client = new KalshiClient({
      apiKey: process.env.KALSHI_API_KEY,
      demo: process.env.KALSHI_DEMO !== "false",
    });
  }

  // 1. Fetch markets
  const markets = await fetchMarkets(client);
  if (markets.length < MIN_MARKETS) {
    console.error(`Need at least ${MIN_MARKETS} markets, got ${markets.length}`);
    process.exit(1);
  }

  // 2. Select top markets by volume for analysis
  const selectedMarkets = markets.slice().sort((a, b) => b.volume - a.volume).slice(0, Math.max(MIN_MARKETS, 5));
  console.log(`Selected ${selectedMarkets.length} markets for signal generation`);

  // 3. Fetch history and enrich markets
  const enrichedMarkets = [];
  for (const market of selectedMarkets) {
    const candles = await fetchCandles(client, market.ticker, market.yes_mid);
    const metrics = computeHistoryMetrics(candles);
    enrichedMarkets.push({
      ...market,
      price_history_mean: metrics.mean,
      price_history_stddev: metrics.stddev,
      price_change_24h: metrics.priceChange,
      candles,
    });
    console.log(`  ${market.ticker}: yes_mid=${market.yes_mid}c, mean=${metrics.mean.toFixed(1)}, stddev=${metrics.stddev.toFixed(1)}, change=${metrics.priceChange.toFixed(1)}c`);
  }

  // 3.5. Settlement check (T330) — settle old trades before generating new signals
  const paperTradesDB = getPaperTradesDB();
  let capitalFloorStatus = PAPER_TRADING ? getCapitalFloorStatus(paperTradesDB) : null;
  let finalCapitalFloorStatus = capitalFloorStatus;
  let tradingHalted = false;
  let haltReason = null;

  if (PAPER_TRADING && EXECUTE_TRADES) {
    console.log("\n📋 Checking for trades to settle...");
    const settlementResult = runSettlement(enrichedMarkets, Date.now());
    if (settlementResult.settled > 0) {
      console.log(`  Settled ${settlementResult.settled} trades: ${settlementResult.wins} wins, ${settlementResult.losses} losses`);
      console.log(`  Total P&L: $${(settlementResult.totalPnL / 100).toFixed(2)}`);
    } else {
      console.log("  No trades ready for settlement");
    }

    capitalFloorStatus = getCapitalFloorStatus(paperTradesDB);
    finalCapitalFloorStatus = capitalFloorStatus;
    console.log("\n💵 Post-settlement capital check...");
    logCapitalFloorStatus(capitalFloorStatus, "Pre-trade");
    if (capitalFloorStatus.breached) {
      tradingHalted = true;
      haltReason = `capital floor breached: current capital $${(capitalFloorStatus.currentCapitalCents / 100).toFixed(2)} below $${(capitalFloorStatus.floorCents / 100).toFixed(2)}`;
    }
  }

  // 4. Run strategies (Task 325: HARD DISABLE — only mean_reversion enabled)
  // mean_reversion: ENABLED (best performer)
  // momentum: HARD DISABLED (10% win rate — poor performance)
  // crypto_edge: HARD DISABLED (11.1% win rate — poor performance)
  // nfp_nowcast: HARD DISABLED (for clean 50-trade run)
  // econ_edge: HARD DISABLED (for clean 50-trade run)
  const engine = new SignalEngine({ minConfidence: 0.65, minEdge: 1 });  // T334 optimized: confidence=0.65
  const sizer = new PositionSizer({ accountBalance: 100000, maxRiskPerTrade: 0.02 });

  const meanReversion = new MeanReversionStrategy({ zScoreThreshold: 1.2, minVolume: 10000 });  // T334 optimized: zScore=1.2
  // HARD DISABLED per T325: momentum, crypto_edge, nfp_nowcast, econ_edge

  const mrSignals = engine.scan(enrichedMarkets, meanReversion);
  // All other strategies hard-disabled
  const momSignals = [];
  const cryptoSignals = [];
  const nfpSignals = [];
  const econSignals = [];

  // 5. Size positions
  const marketMap = Object.fromEntries(
    enrichedMarkets.flatMap((m) => [[m.id, m], [m.ticker, m]])
  );
  const sizedMr = sizer.sizeSignals(mrSignals, marketMap);
  // Disabled strategies return empty arrays
  const sizedMom = [];
  const sizedCrypto = [];
  const sizedNfp = [];
  const sizedEcon = [];

  // 6. Build output signals (T325: ONLY mean_reversion)
  const allSignals = [
    ...sizedMr.map((s) => ({ ...s, strategy: "mean_reversion", ticker: marketMap[s.marketId]?.ticker })),
    // DISABLED per T325: momentum, crypto_edge, nfp_nowcast, econ_edge
  ];

  // 7. Risk management check
  let approvedSignals = allSignals;
  let rejectedSignals = [];
  
  if (tradingHalted) {
    approvedSignals = [];
    rejectedSignals = allSignals.map((signal) => ({ signal, reason: haltReason }));
    console.log(`\n🛑 Trading halted before risk checks — ${haltReason}`);
  } else {
    try {
      console.log("\n🔒 Running risk checks...");
      const riskSummary = await getRiskSummary();
      console.log(`  Risk Status: ${riskSummary.status}`);
      console.log(`  Daily P&L: $${(riskSummary.current.dailyPnL.total / 100).toFixed(2)}`);
      console.log(`  Total Exposure: $${(riskSummary.current.totalExposure / 100).toFixed(2)} / $${(riskSummary.limits.maxTotalExposure / 100).toFixed(2)}`);
      
      // Validate each signal against risk limits
      approvedSignals = [];
      
      for (const signal of allSignals) {
        const trade = {
          marketTicker: signal.ticker || signal.marketId,
          side: signal.side,
          quantity: signal.sizing?.contracts || 1,
          price: signal.currentPrice || 50,
        };
        
        const validation = await validateTrade(trade);
        if (validation.approved) {
          approvedSignals.push(signal);
        } else {
          rejectedSignals.push({ signal, reason: validation.reasons[0] });
        }
      }
      
      if (rejectedSignals.length > 0) {
        console.log(`  ⚠️  Risk rejected ${rejectedSignals.length} signals:`);
        rejectedSignals.forEach(r => console.log(`    - ${r.signal.ticker || r.signal.marketId}: ${r.reason}`));
      }
      console.log(`  ✅ Risk approved ${approvedSignals.length} signals`);
    } catch (riskErr) {
      console.log(`  ⚠️  Risk manager unavailable (${riskErr.message}) — approving all ${allSignals.length} signals`);
      approvedSignals = allSignals;
      rejectedSignals = [];
    }
  }

  // 8. Execute trades if requested (only approved signals)
  let executionReport = null;
  
  // Get current run number for trade tracking (T330)
  const runNumberFile = path.join(OUTPUT_ROOT, "run_counter.txt");
  let currentRunNumber = 0;
  try {
    currentRunNumber = parseInt(fs.readFileSync(runNumberFile, "utf8")) || 0;
  } catch (_) {}
  
  if (EXECUTE_TRADES && tradingHalted) {
    console.log("\n🧯 Capital floor halt active — skipping trade execution");
    executionReport = {
      mode: PAPER_TRADING ? "paper_trading" : "live_trading",
      executed: 0,
      rejected: approvedSignals.length,
      failed: 0,
      persisted: 0,
      halted: true,
      haltReason,
      trades: [],
    };
  } else if (EXECUTE_TRADES && approvedSignals.length > 0) {
    if (PAPER_TRADING) {
      console.log("\n📝 PAPER TRADING MODE — logging trades without execution");
      
      // Persist trades to database (T323)
      // T331: Skip trades with NULL confidence (Grace's finding)
      const persistedTrades = [];
      let skippedNullConfidence = 0;
      for (const s of approvedSignals) {
        // T331: Validate confidence before recording
        if (s.confidence == null || typeof s.confidence !== 'number' || isNaN(s.confidence)) {
          console.warn(`  ⚠️  Skipping trade for ${s.ticker || s.marketId}: NULL or invalid confidence`);
          skippedNullConfidence++;
          continue;
        }

        // T714: Per-trade stop-loss — reject trades that risk more than MAX_TRADE_PCT of capital
        if (PAPER_TRADING && s.currentPrice != null) {
          const tradeCostCents = Math.round((s.currentPrice / 100) * (s.sizing?.contracts || 1) * 100);
          const maxAllowedCents = Math.round(PAPER_TRADING_INITIAL_CAPITAL_CENTS * PAPER_TRADING_MAX_TRADE_PCT);
          if (tradeCostCents > maxAllowedCents) {
            console.warn(`  🛑 T714 stop-loss: rejecting ${s.ticker || s.marketId} — trade cost $${(tradeCostCents/100).toFixed(2)} exceeds ${(PAPER_TRADING_MAX_TRADE_PCT*100).toFixed(0)}% cap ($${(maxAllowedCents/100).toFixed(2)})`);
            continue;
          }
        }
        
        const tradeRecord = paperTradesDB.recordTrade({
          timestamp: new Date().toISOString(),
          market: s.ticker || s.marketId,
          signal_type: s.strategy,
          confidence: s.confidence,
          direction: s.side?.toUpperCase(),
          contracts: s.sizing?.contracts || 1,
          entry_price: s.currentPrice,
          status: "OPEN",
          outcome: "PENDING",
          metadata: {
            targetPrice: s.targetPrice,
            expectedEdge: s.expectedEdge,
            reason: s.reason,
            runNumber: currentRunNumber + 1, // Track when trade was opened (T330)
          },
        });
        persistedTrades.push(tradeRecord);
      }
      
      if (skippedNullConfidence > 0) {
        console.log(`  ⚠️  Skipped ${skippedNullConfidence} trades with NULL confidence (T331)`);
      }
      
      executionReport = {
        mode: "paper_trading",
        executed: approvedSignals.length,
        rejected: 0,
        failed: 0,
        persisted: persistedTrades.length,
        halted: false,
        haltReason: null,
        trades: approvedSignals.map(s => ({
          ticker: s.ticker || s.marketId,
          side: s.side,
          contracts: s.sizing?.contracts || 1,
          price: s.currentPrice,
          strategy: s.strategy,
          confidence: s.confidence,
          expectedEdge: s.expectedEdge,
          timestamp: new Date().toISOString(),
        })),
      };
      
      // Write paper trade log (legacy format for backward compatibility)
      const paperTradeLogFile = path.join(OUTPUT_ROOT, "paper_trade_log.json");
      fs.mkdirSync(path.dirname(paperTradeLogFile), { recursive: true });
      fs.writeFileSync(paperTradeLogFile, JSON.stringify(executionReport, null, 2));
      console.log(`  Logged ${executionReport.executed} paper trades to paper_trade_log.json`);
      console.log(`  Persisted ${persistedTrades.length} trades to paper_trades.db`);
    } else {
      console.log("\n🚀 LIVE TRADING MODE — executing real orders via Kalshi API");
      const engine = new ExecutionEngine({
        kalshiClient: client,
        demoMode: false,
      });
      executionReport = await engine.executeSignals(approvedSignals, enrichedMarkets);
      console.log(`Executed: ${executionReport.executed}, Rejected: ${executionReport.rejected}, Failed: ${executionReport.failed}`);
    }
  } else if (EXECUTE_TRADES) {
    console.log("\n⏸️  No signals passed risk checks — skipping execution");
  }

  // 9. Paper Trade Settlement (T330)
  // Settle open trades that have aged enough (3+ candles)
  if (PAPER_TRADING) {
    console.log("\n💰 Running paper trade settlement...");
    try {
      // Get run number from file or default to 0
      const runNumberFile = path.join(OUTPUT_ROOT, "run_counter.txt");
      let runNumber = 0;
      try {
        runNumber = parseInt(fs.readFileSync(runNumberFile, "utf8")) || 0;
      } catch (_) {}
      runNumber++;
      fs.writeFileSync(runNumberFile, runNumber.toString());
      
      const settlement = runSettlement(enrichedMarkets, runNumber);
      
      if (settlement.settled > 0) {
        console.log(`  Settled ${settlement.settled} trades:`);
        console.log(`    Wins: ${settlement.wins}, Losses: ${settlement.losses}`);
        console.log(`    Total P&L: $${(settlement.totalPnL / 100).toFixed(2)}`);
        for (const s of settlement.details.settled) {
          console.log(`    - ${s.market}: ${s.outcome} $${(s.pnl / 100).toFixed(2)} (${s.direction} ${s.entryPrice}c → ${s.exitPrice}c)`);
        }
      } else {
        console.log(`  No trades ready for settlement (${settlement.skipped} skipped)`);
      }

      finalCapitalFloorStatus = getCapitalFloorStatus(paperTradesDB);
      console.log("\n💵 Capital floor status after settlement...");
      logCapitalFloorStatus(finalCapitalFloorStatus, "Post-run");
      if (!tradingHalted && finalCapitalFloorStatus.breached) {
        tradingHalted = true;
        haltReason = `capital floor breached: current capital $${(finalCapitalFloorStatus.currentCapitalCents / 100).toFixed(2)} below $${(finalCapitalFloorStatus.floorCents / 100).toFixed(2)}`;
        if (executionReport && executionReport.halted == null) {
          executionReport.halted = true;
          executionReport.haltReason = haltReason;
        }
      }
    } catch (settleErr) {
      console.log(`  ⚠️  Settlement error: ${settleErr.message}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: USE_MOCK_FALLBACK ? "mock_fallback" : "kalshi_live",
    marketCount: enrichedMarkets.length,
    signalCount: allSignals.length,
    approvedSignalCount: approvedSignals.length,
    rejectedSignalCount: rejectedSignals.length,
    halted: tradingHalted,
    haltReason,
    capitalFloor: finalCapitalFloorStatus,
    executed: executionReport ? executionReport.executed > 0 : false,
    executionReport: executionReport || undefined,
    markets: enrichedMarkets.map((m) => ({
      id: m.id,
      ticker: m.ticker,
      title: m.title,
      category: m.category,
      yesMid: m.yes_mid,
      noMid: m.no_mid,
      volume: m.volume,
      priceHistoryMean: m.price_history_mean,
      priceHistoryStddev: m.price_history_stddev,
      priceChange24h: m.price_change_24h,
    })),
    signals: allSignals.map((s) => ({
      strategy: s.strategy,
      marketId: s.marketId,
      ticker: marketMap[s.marketId]?.ticker,
      side: s.side,
      signalType: s.signalType,
      confidence: parseFloat(s.confidence.toFixed(4)),
      targetPrice: s.targetPrice,
      currentPrice: s.currentPrice,
      expectedEdge: s.expectedEdge,
      recommendedContracts: s.sizing.contracts,
      riskAmount: s.sizing.riskAmount,
      reason: s.reason,
    })),
  };

  // 7. Write output
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  console.log(`\n✅ Wrote ${allSignals.length} signals to ${OUTPUT_FILE}`);
  for (const s of allSignals) {
    console.log(`  [${s.strategy}] ${s.side.toUpperCase()} ${s.ticker} @ ${s.currentPrice}c — size=${s.sizing.contracts} contracts (conf=${(s.confidence * 100).toFixed(1)}%)`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = {
  computeMidPrice,
  normalizeMarket,
  fetchMarkets,
  fetchCandles,
  computeHistoryMetrics,
  getCapitalFloorStatus,
  main,
};
