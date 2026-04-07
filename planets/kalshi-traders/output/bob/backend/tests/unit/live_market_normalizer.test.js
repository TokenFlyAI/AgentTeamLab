"use strict";

const assert = require("assert");
const { normalizeMarket, normalizeMarkets } = require("../../lib/live_market_normalizer");

function testSnakeCasePayload() {
  const market = normalizeMarket({
    id: "m-1",
    ticker: "KXBTC-26DEC31-T110000",
    title: "Will Bitcoin close above $110,000 on Dec 31, 2026?",
    category: "Crypto",
    status: "active",
    yes_bid: 42,
    yes_ask: 46,
    no_bid: 54,
    no_ask: 58,
    volume: 125000,
    open_interest: 4800,
    series_ticker: "KXBTC-26DEC31",
    event_ticker: "KXBTC",
    floor_strike: 110000,
    strike_type: "greater_than",
  });

  assert.equal(market.yes_mid, 44);
  assert.equal(market.no_mid, 56);
  assert.equal(market.metadata.contract_value_cents, 100);
  assert.equal(market.metadata.contract_value_confirmed, false);
  assert.equal(market.metadata.strike.floor, 110000);
}

function testCamelCasePayloadAndDerivedNoQuotes() {
  const market = normalizeMarket({
    marketId: "m-2",
    marketTicker: "KXINF-26JUN-T030",
    name: "Will CPI print above 3.0% in June 2026?",
    marketCategory: "Economics",
    marketStatus: "open",
    yesBid: "31",
    yesAsk: "35",
    volume24h: "88000",
    openInterest: "7000",
    closeDate: "2026-06-12T15:00:00Z",
  });

  assert.equal(market.id, "m-2");
  assert.equal(market.ticker, "KXINF-26JUN-T030");
  assert.equal(market.no_bid, 65);
  assert.equal(market.no_ask, 69);
  assert.equal(market.yes_mid, 33);
  assert.equal(market.no_mid, 67);
  assert.equal(market.close_date, "2026-06-12T15:00:00.000Z");
  assert.equal(market.metadata.assumptions.derivedNoQuotesFromYes, true);
}

function testMalformedPayloadFailsLoudly() {
  assert.throws(
    () =>
      normalizeMarket(
        {
          ticker: "BAD-1",
          yes_bid: 20,
          yes_ask: 25,
        },
        { strict: true }
      ),
    /missing title/i
  );

  const result = normalizeMarkets(
    [
      {
        ticker: "GOOD-1",
        title: "Good market",
        yes_bid: 48,
        yes_ask: 50,
      },
      {
        ticker: "BAD-2",
        title: "Bad market",
      },
    ],
    { strict: true }
  );

  assert.equal(result.normalized.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /missing core fields/i);
}

function main() {
  testSnakeCasePayload();
  testCamelCasePayloadAndDerivedNoQuotes();
  testMalformedPayloadFailsLoudly();
  console.log("live_market_normalizer.test.js: PASS");
}

main();
