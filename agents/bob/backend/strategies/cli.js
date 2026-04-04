#!/usr/bin/env node
/**
 * Strategy CLI
 * Run strategies, update performance, and manage strategy state.
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

const { Pool } = require("pg");
const {
  StrategyRunner,
  MeanReversionStrategy,
  MomentumStrategy,
  PnLTracker,
} = require("./");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "kalshi_trading",
  user: process.env.DB_USER || "trader",
  password: process.env.DB_PASSWORD,
});

const runner = new StrategyRunner({ pool });
runner.register("mean_reversion", new MeanReversionStrategy());
runner.register("momentum", new MomentumStrategy());
const pnlTracker = new PnLTracker({ pool });

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "run-all": {
      console.log("Running all active strategies...");
      const results = await runner.runAll();
      for (const result of results) {
        if (result.error) {
          console.error(`Strategy ${result.strategyId} failed:`, result.error);
        } else {
          console.log(
            `Strategy ${result.strategyId} (${result.strategyType}): ${result.signalCount} signals`
          );
          for (const signal of result.signals.slice(0, 5)) {
            console.log(
              `  - ${signal.side.toUpperCase()} ${signal.marketId} @ ${signal.currentPrice}c ` +
                `(conf=${(signal.confidence * 100).toFixed(1)}%, size=${signal.sizing.contracts})`
            );
          }
        }
      }
      break;
    }

    case "update-pnl": {
      console.log("Updating P&L summaries...");
      await runner.updatePerformanceSummaries();
      console.log("Done.");
      break;
    }

    case "snapshot": {
      console.log("Recording performance snapshots...");
      const strategies = await runner.loadActiveStrategies();
      for (const strategy of strategies) {
        await pnlTracker.recordSnapshot(strategy.id, "daily", new Date());
        console.log(`  Snapshot recorded for ${strategy.name}`);
      }
      break;
    }

    case "list": {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, name, strategy_type, status, total_pnl, total_trades FROM strategies ORDER BY created_at DESC`
        );
        console.table(result.rows);
      } finally {
        client.release();
      }
      break;
    }

    default: {
      console.log(`Usage: node cli.js <command>
Commands:
  run-all      Run all active strategies
  update-pnl   Update strategy P&L summaries
  snapshot     Record daily performance snapshots
  list         List all strategies
`);
      process.exit(1);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
