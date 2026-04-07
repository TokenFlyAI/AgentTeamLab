#!/usr/bin/env node
"use strict";

const assert = require("assert");
const https = require("https");
const { EventEmitter } = require("events");
const { KalshiClient } = require("../../backend/kalshi_client");

const results = {
  passed: 0,
  failed: 0,
  tests: [],
};

function log(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

async function runTest(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.passed++;
    results.tests.push({ name, status: "PASS", duration });
    log("PASS", `${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    results.failed++;
    results.tests.push({ name, status: "FAIL", duration, error: error.message });
    log("FAIL", `${name}: ${error.message}`);
  }
}

function createMockResponse(statusCode, body, headers = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.statusMessage = statusCode === 200 ? "OK" : "ERROR";
  res.headers = headers;

  process.nextTick(() => {
    if (body !== undefined) {
      res.emit("data", JSON.stringify(body));
    }
    res.emit("end");
  });

  return res;
}

async function withMockedHttps(handler, fn) {
  const originalRequest = https.request;
  https.request = handler;

  try {
    return await fn();
  } finally {
    https.request = originalRequest;
  }
}

function buildMockRequest(calls, responseFactory) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      const call = {
        ts: Date.now(),
        url: String(url),
        method: options.method,
        headers: options.headers,
      };
      calls.push(call);
      callback(createMockResponse(200, responseFactory(call)));
    };
    return req;
  };
}

function maxRequestsInSlidingWindow(timestamps, windowMs) {
  let max = 0;

  for (let left = 0, right = 0; right < timestamps.length; right++) {
    while (timestamps[right] - timestamps[left] >= windowMs) {
      left++;
    }
    max = Math.max(max, right - left + 1);
  }

  return max;
}

async function main() {
  await runTest("55 concurrent requests are throttled by KalshiClient rate limiter", async () => {
    const calls = [];
    const client = new KalshiClient({
      apiKey: "test_key_t716",
      demo: true,
      rateLimit: { maxRequests: 10, windowMs: 100 },
      timeout: 1000,
    });

    await withMockedHttps(buildMockRequest(calls, () => ({ markets: [] })), async () => {
      const start = Date.now();
      await Promise.all(
        Array.from({ length: 55 }, (_, i) =>
          client.getMarkets({ limit: 1, cursor: `batch-${i}` })
        )
      );
      const elapsed = Date.now() - start;

      assert.strictEqual(calls.length, 55, `expected 55 outbound requests, got ${calls.length}`);
      assert(
        elapsed >= 430,
        `expected throttled burst to take at least 430ms, got ${elapsed}ms`
      );
      assert(
        elapsed < 2000,
        `expected throttled burst to finish within 2000ms, got ${elapsed}ms`
      );

      const timestamps = calls.map((call) => call.ts).sort((a, b) => a - b);
      const observedMax = maxRequestsInSlidingWindow(timestamps, 100);
      assert(
        observedMax <= 10,
        `expected at most 10 requests in any 100ms window, saw ${observedMax}`
      );
    });
  });

  await runTest("Request metadata is preserved while rate limiting under load", async () => {
    const calls = [];
    const client = new KalshiClient({
      apiKey: "test_key_t716",
      demo: false,
      rateLimit: { maxRequests: 5, windowMs: 80 },
      timeout: 1000,
    });

    await withMockedHttps(buildMockRequest(calls, () => ({ ok: true })), async () => {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          client.getCandles(`MARKET-${i}`, {
            resolution: "5m",
            from: 1000 + i,
            to: 2000 + i,
          })
        )
      );
    });

    assert.strictEqual(calls.length, 12, `expected 12 calls, got ${calls.length}`);
    calls.forEach((call) => {
      assert.strictEqual(call.method, "GET");
      assert.strictEqual(call.headers.Authorization, "Bearer test_key_t716");
      assert(
        call.url.startsWith("https://trading-api.kalshi.com/v1/markets/MARKET-") &&
          call.url.includes("/candles?"),
        `unexpected request URL: ${call.url}`
      );
      const marketId = Number(call.url.match(/MARKET-(\d+)/)?.[1]);
      assert(Number.isInteger(marketId), `expected market id in URL: ${call.url}`);
      assert(call.url.includes("resolution=5m"));
      assert(call.url.includes(`from=${1000 + marketId}`));
      assert(call.url.includes(`to=${2000 + marketId}`));
    });
  });

  await runTest("Rate limiter window resets after cooldown", async () => {
    const calls = [];
    const client = new KalshiClient({
      apiKey: "test_key_t716",
      demo: true,
      rateLimit: { maxRequests: 5, windowMs: 120 },
      timeout: 1000,
    });

    await withMockedHttps(buildMockRequest(calls, () => ({ balance: 10000 })), async () => {
      await Promise.all(Array.from({ length: 5 }, () => client.getBalance()));

      await new Promise((resolve) => setTimeout(resolve, 150));

      const start = Date.now();
      await client.getBalance();
      const elapsed = Date.now() - start;

      assert(
        elapsed < 40,
        `expected post-cooldown request to be immediate, got ${elapsed}ms`
      );
      assert.strictEqual(calls.length, 6, `expected 6 total calls, got ${calls.length}`);
      const gap = calls[5].ts - calls[4].ts;
      assert(gap >= 120, `expected cooldown gap >= 120ms, got ${gap}ms`);
    });
  });

  console.log("\n" + "=".repeat(60));
  console.log("KALSHI CLIENT RATE LIMIT TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed} ✅`);
  console.log(`Failed: ${results.failed} ❌`);
  console.log("=".repeat(60));

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test runner error:", error);
  process.exit(1);
});
