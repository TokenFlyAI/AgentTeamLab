/**
 * Strategy Framework Entry Point
 * Author: Bob (Backend Engineer)
 * Task: #220
 */

"use strict";

const { SignalEngine } = require("./signal_engine");
const { PositionSizer } = require("./position_sizer");
const { PnLTracker } = require("./pnl_tracker");
const { StrategyRunner } = require("./strategy_runner");
const { MeanReversionStrategy } = require("./strategies/mean_reversion");
const { MomentumStrategy } = require("./strategies/momentum");
const { LongshotFadingStrategy } = require("./strategies/longshot_fading");
const { EconomicMomentumStrategy } = require("./strategies/economic_momentum");
const { CrossPlatformArbitrageStrategy } = require("./strategies/cross_platform_arbitrage");

module.exports = {
  SignalEngine,
  PositionSizer,
  PnLTracker,
  StrategyRunner,
  MeanReversionStrategy,
  MomentumStrategy,
  LongshotFadingStrategy,
  EconomicMomentumStrategy,
  CrossPlatformArbitrageStrategy,
};
