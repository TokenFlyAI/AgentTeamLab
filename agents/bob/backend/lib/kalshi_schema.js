/**
 * Kalshi API Schema Validators
 * Author: Mia (API Engineer)
 * Task: T287 — JSON schema validators for all Kalshi API responses
 *
 * Validates response shapes so bad data fails loudly before it propagates
 * to strategies, screeners, and the dashboard.
 */

"use strict";

// ---------------------------------------------------------------------------
// Helper Utilities
// ---------------------------------------------------------------------------

function isString(v) {
  return typeof v === "string";
}

function isNumber(v) {
  return typeof v === "number" && !isNaN(v);
}

function isInteger(v) {
  return isNumber(v) && Number.isInteger(v);
}

function isBoolean(v) {
  return typeof v === "boolean";
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isArray(v) {
  return Array.isArray(v);
}

function isOptionalString(v) {
  return v === undefined || v === null || isString(v);
}

function isOptionalNumber(v) {
  return v === undefined || v === null || isNumber(v);
}

// ---------------------------------------------------------------------------
// Kalshi Market Object
// ---------------------------------------------------------------------------

function validateMarket(market, path = "market") {
  const errors = [];
  if (!isObject(market)) {
    errors.push(`${path} must be an object`);
    return errors;
  }

  if (!isString(market.ticker)) errors.push(`${path}.ticker is required (string)`);
  if (!isString(market.title)) errors.push(`${path}.title is required (string)`);
  if (!isOptionalString(market.category)) errors.push(`${path}.category must be a string or null`);
  if (!isOptionalString(market.status)) errors.push(`${path}.status must be a string or null`);
  if (!isOptionalNumber(market.yes_bid) && !isOptionalNumber(market.yesBid)) {
    errors.push(`${path}.yes_bid/yesBid must be a number or null`);
  }
  if (!isOptionalNumber(market.yes_ask) && !isOptionalNumber(market.yesAsk)) {
    errors.push(`${path}.yes_ask/yesAsk must be a number or null`);
  }
  if (!isOptionalNumber(market.no_bid) && !isOptionalNumber(market.noBid)) {
    errors.push(`${path}.no_bid/noBid must be a number or null`);
  }
  if (!isOptionalNumber(market.no_ask) && !isOptionalNumber(market.noAsk)) {
    errors.push(`${path}.no_ask/noAsk must be a number or null`);
  }
  if (!isOptionalNumber(market.volume)) errors.push(`${path}.volume must be a number or null`);
  if (!isOptionalNumber(market.open_interest) && !isOptionalNumber(market.openInterest)) {
    errors.push(`${path}.open_interest/openInterest must be a number or null`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Kalshi API Response: GET /markets
// ---------------------------------------------------------------------------

function validateMarketsResponse(response, path = "response") {
  const errors = [];
  if (!isObject(response)) {
    errors.push(`${path} must be an object`);
    return { valid: false, errors };
  }

  const markets = response.markets || (response.data && response.data.markets);
  if (!isArray(markets)) {
    errors.push(`${path}.markets (or response.data.markets) must be an array`);
  } else {
    for (let i = 0; i < markets.length; i++) {
      errors.push(...validateMarket(markets[i], `${path}.markets[${i}]`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Kalshi API Response: GET /markets/:ticker/candles
// ---------------------------------------------------------------------------

function validateCandle(candle, path = "candle") {
  const errors = [];
  if (!isObject(candle)) {
    errors.push(`${path} must be an object`);
    return errors;
  }

  if (!isString(candle.candle_time) && !isString(candle.time)) {
    errors.push(`${path}.candle_time/time is required (string)`);
  }
  if (!isOptionalNumber(candle.yes_open) && !isOptionalNumber(candle.open)) {
    errors.push(`${path}.yes_open/open must be a number or null`);
  }
  if (!isOptionalNumber(candle.yes_high) && !isOptionalNumber(candle.high)) {
    errors.push(`${path}.yes_high/high must be a number or null`);
  }
  if (!isOptionalNumber(candle.yes_low) && !isOptionalNumber(candle.low)) {
    errors.push(`${path}.yes_low/low must be a number or null`);
  }
  if (!isOptionalNumber(candle.yes_close) && !isOptionalNumber(candle.close)) {
    errors.push(`${path}.yes_close/close must be a number or null`);
  }
  if (!isOptionalNumber(candle.yes_volume) && !isOptionalNumber(candle.volume)) {
    errors.push(`${path}.yes_volume/volume must be a number or null`);
  }

  return errors;
}

function validateCandlesResponse(response, path = "response") {
  const errors = [];
  if (!isObject(response)) {
    errors.push(`${path} must be an object`);
    return { valid: false, errors };
  }

  const candles = response.candles || (response.data && response.data.candles);
  if (!isArray(candles)) {
    errors.push(`${path}.candles (or response.data.candles) must be an array`);
  } else {
    for (let i = 0; i < candles.length; i++) {
      errors.push(...validateCandle(candles[i], `${path}.candles[${i}]`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Kalshi API Response: GET /markets/:ticker/orderbook
// ---------------------------------------------------------------------------

function validateOrderbookLevel(level, path = "level") {
  const errors = [];
  if (!isObject(level)) {
    errors.push(`${path} must be an object`);
    return errors;
  }
  if (!isNumber(level.price)) errors.push(`${path}.price is required (number)`);
  if (!isNumber(level.size) && !isNumber(level.count)) {
    errors.push(`${path}.size/count is required (number)`);
  }
  return errors;
}

function validateOrderbookResponse(response, path = "response") {
  const errors = [];
  if (!isObject(response)) {
    errors.push(`${path} must be an object`);
    return { valid: false, errors };
  }

  if (!isArray(response.bids)) errors.push(`${path}.bids must be an array`);
  else {
    for (let i = 0; i < response.bids.length; i++) {
      errors.push(...validateOrderbookLevel(response.bids[i], `${path}.bids[${i}]`));
    }
  }

  if (!isArray(response.asks)) errors.push(`${path}.asks must be an array`);
  else {
    for (let i = 0; i < response.asks.length; i++) {
      errors.push(...validateOrderbookLevel(response.asks[i], `${path}.asks[${i}]`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Trade Signals Output (live_runner.js)
// ---------------------------------------------------------------------------

function validateSignal(signal, path = "signal") {
  const errors = [];
  if (!isObject(signal)) {
    errors.push(`${path} must be an object`);
    return errors;
  }

  if (!isString(signal.strategy)) errors.push(`${path}.strategy is required (string)`);
  if (!isString(signal.marketId) && !isString(signal.ticker)) {
    errors.push(`${path}.marketId or ticker is required (string)`);
  }
  if (!isString(signal.side)) errors.push(`${path}.side is required (string)`);
  if (!isNumber(signal.confidence)) errors.push(`${path}.confidence is required (number)`);
  if (!isOptionalNumber(signal.targetPrice)) errors.push(`${path}.targetPrice must be a number or null`);
  if (!isOptionalNumber(signal.currentPrice)) errors.push(`${path}.currentPrice must be a number or null`);
  if (!isOptionalNumber(signal.expectedEdge)) errors.push(`${path}.expectedEdge must be a number or null`);
  if (!isOptionalNumber(signal.recommendedContracts)) errors.push(`${path}.recommendedContracts must be a number or null`);
  if (!isOptionalString(signal.reason)) errors.push(`${path}.reason must be a string or null`);

  return errors;
}

function validateTradeSignalsOutput(output, path = "output") {
  const errors = [];
  if (!isObject(output)) {
    errors.push(`${path} must be an object`);
    return { valid: false, errors };
  }

  if (!isString(output.generatedAt)) errors.push(`${path}.generatedAt is required (string)`);
  if (!isString(output.source)) errors.push(`${path}.source is required (string)`);
  if (!isNumber(output.marketCount)) errors.push(`${path}.marketCount is required (number)`);
  if (!isNumber(output.signalCount)) errors.push(`${path}.signalCount is required (number)`);

  if (isArray(output.markets)) {
    for (let i = 0; i < output.markets.length; i++) {
      errors.push(...validateMarket(output.markets[i], `${path}.markets[${i}]`));
    }
  } else {
    errors.push(`${path}.markets must be an array`);
  }

  if (isArray(output.signals)) {
    for (let i = 0; i < output.signals.length; i++) {
      errors.push(...validateSignal(output.signals[i], `${path}.signals[${i}]`));
    }
  } else {
    errors.push(`${path}.signals must be an array`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Screener Output (screener.js)
// ---------------------------------------------------------------------------

function validateScreenerMarket(market, path = "market") {
  const errors = [];
  if (!isObject(market)) {
    errors.push(`${path} must be an object`);
    return errors;
  }

  if (!isString(market.ticker)) errors.push(`${path}.ticker is required (string)`);
  if (!isString(market.title)) errors.push(`${path}.title is required (string)`);
  if (!isString(market.category)) errors.push(`${path}.category is required (string)`);
  if (!isNumber(market.volume)) errors.push(`${path}.volume is required (number)`);
  if (!isNumber(market.yesMid)) errors.push(`${path}.yesMid is required (number)`);
  if (!isNumber(market.noMid)) errors.push(`${path}.noMid is required (number)`);
  if (!isNumber(market.spreadPct)) errors.push(`${path}.spreadPct is required (number)`);
  if (!isNumber(market.volatility)) errors.push(`${path}.volatility is required (number)`);
  if (!isNumber(market.volumeScore)) errors.push(`${path}.volumeScore is required (number)`);
  if (!isNumber(market.spreadScore)) errors.push(`${path}.spreadScore is required (number)`);
  if (!isNumber(market.volatilityScore)) errors.push(`${path}.volatilityScore is required (number)`);
  if (!isNumber(market.compositeScore)) errors.push(`${path}.compositeScore is required (number)`);

  return errors;
}

function validateScreenerOutput(output, path = "output") {
  const errors = [];
  if (!isObject(output)) {
    errors.push(`${path} must be an object`);
    return { valid: false, errors };
  }

  if (!isString(output.generatedAt)) errors.push(`${path}.generatedAt is required (string)`);
  if (!isString(output.source)) errors.push(`${path}.source is required (string)`);
  if (!isNumber(output.totalMarkets)) errors.push(`${path}.totalMarkets is required (number)`);

  if (isArray(output.top10)) {
    for (let i = 0; i < output.top10.length; i++) {
      errors.push(...validateScreenerMarket(output.top10[i], `${path}.top10[${i}]`));
    }
  } else {
    errors.push(`${path}.top10 must be an array`);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Generic Strict Validator (throws on failure)
// ---------------------------------------------------------------------------

function strictValidate(validatorFn, data, label = "data") {
  const result = validatorFn(data);
  if (!result.valid) {
    throw new Error(`Schema validation failed for ${label}:\n  - ${result.errors.join("\n  - ")}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  validateMarket,
  validateMarketsResponse,
  validateCandle,
  validateCandlesResponse,
  validateOrderbookLevel,
  validateOrderbookResponse,
  validateSignal,
  validateTradeSignalsOutput,
  validateScreenerMarket,
  validateScreenerOutput,
  strictValidate,
};
