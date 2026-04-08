#!/usr/bin/env node
/**
 * End-to-End Paper Trading Pipeline — T542
 * Fixed by Frank (QA) to be ticker-agnostic and spec-aligned.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG = {
  outputDir: path.join(__dirname, "../../../public"),
  marketsFilteredPath: path.join(__dirname, "../../../public/markets_filtered.json"),
  marketClustersPath: path.join(__dirname, "../../../public/market_clusters.json"),
  correlationPairsPath: path.join(__dirname, "../../../public/correlation_pairs.json"),
  tradeLogPath: path.join(__dirname, "../../../output/trade_log.json"),
  pnlSummaryPath: path.join(__dirname, "../../../output/pnl_summary.json"),
  minCorrelation: 0.75, 
  spreadThreshold: 0.5,
};

let TICKER_TO_MARKET = {};

function readOption(argv, flag) {
  const exact = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  return null;
}

function parseCliArgs(argv) {
  return {
    phase1Input: readOption(argv, "--phase1-input"),
    artifactDir: readOption(argv, "--artifact-dir"),
    withSignals: argv.includes("--with-signals"),
  };
}

function applyCliConfig(args) {
  if (!args.artifactDir) return;
  const resolvedArtifactDir = path.resolve(args.artifactDir);
  CONFIG.outputDir = resolvedArtifactDir;
  CONFIG.marketsFilteredPath = path.join(resolvedArtifactDir, "markets_filtered.json");
  CONFIG.marketClustersPath = path.join(resolvedArtifactDir, "market_clusters.json");
  CONFIG.correlationPairsPath = path.join(resolvedArtifactDir, "correlation_pairs.json");
  CONFIG.tradeLogPath = path.join(resolvedArtifactDir, "trade_log.json");
  CONFIG.pnlSummaryPath = path.join(resolvedArtifactDir, "pnl_summary.json");
}

function ensureDirectories() {
  const dirs = [path.dirname(CONFIG.marketsFilteredPath), path.dirname(CONFIG.tradeLogPath)];
  for (const dir of dirs) if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadPhase1Fixture(phase1InputPath) {
  const resolvedPath = path.resolve(phase1InputPath);
  if (!fs.existsSync(resolvedPath)) throw new Error(`Phase 1 fixture not found: ${resolvedPath}`);
  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const qualifyingMarkets = Array.isArray(payload.qualifying_markets) ? payload.qualifying_markets : [];
  return { qualifying_markets: qualifyingMarkets, summary: payload.summary || { qualifying: qualifyingMarkets.length } };
}

function runPhase1_MarketFilter(options = {}) {
  console.log("\nPHASE 1: Market Filtering");
  let output;
  if (options.phase1Input) {
    output = loadPhase1Fixture(options.phase1Input);
  } else {
    throw new Error("Synthetic generator omitted in fixed version. Please provide --phase1-input");
  }
  TICKER_TO_MARKET = {};
  for (const m of output.qualifying_markets) TICKER_TO_MARKET[m.ticker] = m;
  fs.writeFileSync(CONFIG.marketsFilteredPath, JSON.stringify(output, null, 2));
  return output;
}

function runPhase2_Clustering(marketsFiltered) {
  console.log("\nPHASE 2: Market Clustering");
  const qualifying = marketsFiltered.qualifying_markets;
  const tickers = qualifying.map(m => m.ticker);
  const clusters = [];

  const getMarketsByCategory = (cat) => qualifying.filter(m => m.category === cat).map(m => m.ticker);
  const getByTicker = (sub) => tickers.filter(t => t.includes(sub));

  const crypto = [...new Set(getMarketsByCategory("Crypto").concat(getByTicker("BTC")).concat(getByTicker("ETH")).concat(getByTicker("SOL")))];
  if (crypto.length >= 2) clusters.push({ id: "crypto_internal", label: "Crypto Markets", markets: crypto, correlation_strength: 0.95, correlation_type: "internal" });

  const econ = [...new Set(getMarketsByCategory("Economics").concat(getByTicker("INXW")).concat(getByTicker("GDP")).concat(getByTicker("CPI")).concat(getByTicker("KXINF")).concat(getByTicker("KXUNEMP")))];
  if (econ.length >= 2) clusters.push({ id: "economics_internal", label: "Economics Markets", markets: econ, correlation_strength: 0.90, correlation_type: "internal" });

  const output = { generated_at: new Date().toISOString(), phase: 2, clusters, totalMarkets: [...new Set(clusters.flatMap(c => c.markets))].length };
  fs.writeFileSync(CONFIG.marketClustersPath, JSON.stringify(output, null, 2));
  return output;
}

function runPhase3_Correlation(marketClusters) {
  console.log("\nPHASE 3: Correlation Detection");
  const pairs = [];
  for (const cluster of marketClusters.clusters || []) {
    const markets = cluster.markets;
    const data = {};
    for (const t of markets) {
      const hist = generatePriceHistory(t, 30);
      data[t] = { prices: hist, current: hist[hist.length - 1] };
    }
    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        const mA = data[markets[i]], mB = data[markets[j]];
        const corr = pearsonCorrelation(mA.prices, mB.prices);
        if (corr >= CONFIG.minCorrelation) {
          const stats = calculateSpreadStats(mA.prices, mB.prices);
          const current = ((mA.current - mA.prices[0]) / mA.prices[0]) - ((mB.current - mB.prices[0]) / mB.prices[0]);
          const dev = Math.abs(current - stats.mean) / stats.std;
          pairs.push({
            cluster: cluster.id, market_a: markets[i], market_b: markets[j],
            pearson_correlation: parseFloat(corr.toFixed(4)), is_arbitrage_opportunity: dev > CONFIG.spreadThreshold,
            arbitrage_confidence: parseFloat((corr * 0.6 + Math.min(dev / CONFIG.spreadThreshold, 1) * 0.4).toFixed(2)),
            direction: current > stats.mean ? "sell_A_buy_B" : "buy_A_sell_B"
          });
        }
      }
    }
  }
  const output = { generated_at: new Date().toISOString(), phase: 3, config: { min_correlation: CONFIG.minCorrelation }, pairs };
  fs.writeFileSync(CONFIG.correlationPairsPath, JSON.stringify(output, null, 2));
  return output;
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const tx = x[i] - mx, ty = y[i] - my;
    num += tx * ty; dx += tx * tx; dy += ty * ty;
  }
  return dx * dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function calculateSpreadStats(x, y) {
  const spreads = [];
  for (let i = 0; i < x.length; i++) spreads.push(((x[i] - x[0]) / x[0]) - ((y[i] - y[0]) / y[0]));
  const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const vari = spreads.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / spreads.length;
  return { mean, std: Math.sqrt(vari) || 0.001 };
}

const _marketFactors = {};
function getMarketFactor(cat, len) {
  if (_marketFactors[cat]) return _marketFactors[cat];
  const seed = cat.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seededRandom = (n) => { const x = Math.sin(seed + n * 7.13) * 10000; return x - Math.floor(x); };
  const factors = [];
  for (let i = 0; i < len; i++) factors.push((seededRandom(i) - 0.5) * 6);
  _marketFactors[cat] = factors;
  return factors;
}

function generatePriceHistory(ticker, len) {
  const market = TICKER_TO_MARKET[ticker] || {};
  let cat = (market.category || "other").toLowerCase();
  let base = market.yes_bid || 50;
  const factors = getMarketFactor(cat, len);
  const prices = [base];
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const seededRandom = (n) => { const x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };
  for (let i = 1; i < len; i++) {
    const change = factors[i] * 0.7 + (seededRandom(i) - 0.5) * 4 * 0.3;
    prices.push(Math.round(Math.max(5, Math.min(95, prices[i-1] + change))));
  }
  return prices;
}

function runPhase4_PaperTrading(pairs) {
  console.log("\nPHASE 4: Paper Trading");
  const trades = pairs.pairs.filter(p => p.is_arbitrage_opportunity).slice(0, 6).map((p, i) => {
    const seed = (p.market_a + p.market_b).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const seededRandom = (n) => { const x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };
    const outcome = seededRandom(1) > 0.4 ? "win" : "loss";
    const pnl_dollars = parseFloat((seededRandom(2) * 2 - 0.5).toFixed(2));
    return { id: `trade_${i+1}`, market_a: p.market_a, market_b: p.market_b, outcome, pnl_dollars };
  });
  fs.writeFileSync(CONFIG.tradeLogPath, JSON.stringify({ trades }, null, 2));
  console.log(`✅ Phase 4 complete: ${trades.length} trades simulated`);
  return trades;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  applyCliConfig(args);
  ensureDirectories();
  const p1 = runPhase1_MarketFilter({ phase1Input: args.phase1Input });
  const p2 = runPhase2_Clustering(p1);
  const p3 = runPhase3_Correlation(p2);
  runPhase4_PaperTrading(p3);
  console.log("\n✅ Fixed Pipeline executed successfully!");
}

if (require.main === module) main().catch(console.error);
