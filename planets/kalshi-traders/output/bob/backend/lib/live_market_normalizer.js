"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function computeMidPrice(bid, ask) {
  if (bid != null && ask != null) {
    return Math.round((bid + ask) / 2);
  }
  if (bid != null) {
    return bid;
  }
  if (ask != null) {
    return ask;
  }
  return null;
}

function invertPrice(price) {
  return price == null ? null : Math.max(0, Math.min(100, 100 - price));
}

function extractStrikeMetadata(payload) {
  return {
    type: firstDefined(payload.strike_type, payload.strikeType, null),
    floor: toNumber(firstDefined(payload.floor_strike, payload.floorStrike, payload.floor, null)),
    cap: toNumber(firstDefined(payload.cap_strike, payload.capStrike, payload.cap, null)),
    value: toNumber(firstDefined(payload.strike, payload.strike_price, payload.strikePrice, null)),
  };
}

function normalizeMarket(rawMarket, opts = {}) {
  if (!isObject(rawMarket)) {
    throw new Error("Market payload must be an object");
  }

  const strict = opts.strict !== false;
  const warnings = [];
  const ticker = firstDefined(rawMarket.ticker, rawMarket.market_ticker, rawMarket.marketTicker);
  const title = firstDefined(rawMarket.title, rawMarket.question, rawMarket.name);

  if (!ticker) {
    throw new Error("Market payload missing ticker");
  }

  if (!title) {
    throw new Error(`Market ${ticker} missing title`);
  }

  const yesBid = toNumber(firstDefined(rawMarket.yes_bid, rawMarket.yesBid, rawMarket.best_yes_bid));
  const yesAsk = toNumber(firstDefined(rawMarket.yes_ask, rawMarket.yesAsk, rawMarket.best_yes_ask));
  let noBid = toNumber(firstDefined(rawMarket.no_bid, rawMarket.noBid, rawMarket.best_no_bid));
  let noAsk = toNumber(firstDefined(rawMarket.no_ask, rawMarket.noAsk, rawMarket.best_no_ask));

  let complementDerived = false;
  if ((noBid == null || noAsk == null) && yesBid != null && yesAsk != null) {
    noBid = noBid ?? invertPrice(yesAsk);
    noAsk = noAsk ?? invertPrice(yesBid);
    complementDerived = true;
    warnings.push("Derived missing NO-side quotes from YES-side complement assumption");
  }

  const yesMid = computeMidPrice(yesBid, yesAsk);
  const noMid = computeMidPrice(noBid, noAsk);
  const volume = toNumber(firstDefined(rawMarket.volume, rawMarket.volume_24h, rawMarket.volume24h)) ?? 0;
  const openInterest = toNumber(firstDefined(rawMarket.open_interest, rawMarket.openInterest)) ?? 0;
  const lastTradePrice = toNumber(firstDefined(rawMarket.last_trade_price, rawMarket.lastTradePrice));
  const lastTradeSize = toNumber(firstDefined(rawMarket.last_trade_size, rawMarket.lastTradeSize));

  const missingCoreFields = [];
  if (yesMid == null) {
    missingCoreFields.push("yes_quote");
  }
  if (strict && missingCoreFields.length > 0) {
    throw new Error(`Market ${ticker} missing core fields: ${missingCoreFields.join(", ")}`);
  }

  if (yesMid == null) {
    warnings.push("Missing YES-side quote; normalized yes_mid is null");
  }

  if (noMid == null) {
    warnings.push("Missing NO-side quote; normalized no_mid is null");
  }

  const strike = extractStrikeMetadata(rawMarket);

  return {
    ...rawMarket,
    id: firstDefined(rawMarket.id, rawMarket.market_id, rawMarket.marketId, ticker),
    ticker,
    title,
    description: firstDefined(rawMarket.description, rawMarket.subtitle, rawMarket.sub_title, null),
    category: firstDefined(rawMarket.category, rawMarket.market_category, rawMarket.marketCategory, "Unknown"),
    status: firstDefined(rawMarket.status, rawMarket.market_status, rawMarket.marketStatus, "active"),
    yes_bid: yesBid,
    yes_ask: yesAsk,
    no_bid: noBid,
    no_ask: noAsk,
    yes_mid: yesMid,
    no_mid: noMid,
    volume,
    volume24h: volume,
    open_interest: openInterest,
    last_trade_price: lastTradePrice,
    last_trade_size: lastTradeSize,
    open_date: toIsoString(firstDefined(rawMarket.open_date, rawMarket.openDate)),
    close_date: toIsoString(firstDefined(rawMarket.close_date, rawMarket.closeDate, rawMarket.expiration_date, rawMarket.expiration)),
    settlement_date: toIsoString(firstDefined(rawMarket.settlement_date, rawMarket.settlementDate)),
    metadata: {
      source: opts.source || "kalshi_api",
      source_field_case: rawMarket.yes_bid !== undefined || rawMarket.no_bid !== undefined ? "snake_case" : "mixed_or_camel_case",
      contract_value_cents: 100,
      contract_value_confirmed: false,
      outcome_type: firstDefined(rawMarket.outcome_type, rawMarket.outcomeType, "binary"),
      market_type: firstDefined(rawMarket.market_type, rawMarket.marketType, "binary"),
      series_ticker: firstDefined(rawMarket.series_ticker, rawMarket.seriesTicker, null),
      event_ticker: firstDefined(rawMarket.event_ticker, rawMarket.eventTicker, null),
      strike,
      settlement_source: firstDefined(rawMarket.settlement_source, rawMarket.settlementSource, null),
      subtitles: {
        yes: firstDefined(rawMarket.yes_sub_title, rawMarket.yesSubtitle, rawMarket.yes_subtitle, null),
        no: firstDefined(rawMarket.no_sub_title, rawMarket.noSubtitle, rawMarket.no_subtitle, null),
      },
      rules: {
        primary: firstDefined(rawMarket.rules_primary, rawMarket.rulesPrimary, null),
        secondary: firstDefined(rawMarket.rules_secondary, rawMarket.rulesSecondary, null),
      },
      assumptions: {
        derivedNoQuotesFromYes: complementDerived,
        settlementCapDollars: 1,
      },
      warnings,
    },
  };
}

function normalizeMarkets(rawMarkets, opts = {}) {
  if (!Array.isArray(rawMarkets)) {
    throw new Error("Markets payload must be an array");
  }

  const normalized = [];
  const errors = [];

  for (const market of rawMarkets) {
    try {
      normalized.push(normalizeMarket(market, opts));
    } catch (error) {
      errors.push({
        ticker: market && typeof market === "object" ? firstDefined(market.ticker, market.market_ticker, market.marketTicker, "unknown") : "unknown",
        error: error.message,
      });
    }
  }

  return {
    normalized,
    errors,
  };
}

module.exports = {
  computeMidPrice,
  normalizeMarket,
  normalizeMarkets,
};
