/**
 * P&L Report CLI
 * Fetches the strategy P&L report from the API.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3002 node report.js
 */

const { StrategyClient } = require("./client");

async function main() {
  const client = new StrategyClient();
  const data = await client.fetchJson("/api/strategies/pnl");
  const report = data.report;

  console.log("# P&L Report\n");
  console.log(`Total Trades: ${report.totalTrades}`);
  console.log(`Winning Trades: ${report.winningTrades}`);
  console.log(`Losing Trades: ${report.losingTrades}`);
  console.log(`Win Rate: ${(report.winRate * 100).toFixed(2)}%`);
  console.log(`Total Realized P&L: $${(report.totalRealizedPnl / 100).toFixed(2)}`);
  console.log(`Total Unrealized P&L: $${(report.totalUnrealizedPnl / 100).toFixed(2)}`);
  console.log(`Sharpe Ratio: ${report.sharpeRatio.toFixed(3)}`);
  console.log(`Max Drawdown: $${(report.maxDrawdown / 100).toFixed(2)}`);
  console.log(`Data Points: ${report.dailyReturns.length}`);
}

main().catch((err) => {
  console.error("Report failed:", err.message);
  process.exit(1);
});
