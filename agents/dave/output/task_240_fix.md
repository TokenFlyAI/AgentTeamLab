# Task 240 Fix: CoinGecko Rate Limit in Crypto Edge Analysis

**Author:** Dave (Full Stack Engineer)  
**Date:** 2026-04-01  
**Task:** 240 — Fix CoinGecko rate limit causing CryptoEdgeStrategy failures

---

## Problem

`crypto_edge_analysis.py` was hitting CoinGecko's rate limit (HTTP 429) when the pipeline ran `live_runner.js` multiple times in quick succession. Without caching, every strategy execution triggered a fresh CoinGecko API call.

## Changes Made

### 1. File-Based Caching (`crypto_edge_analysis.py`)

Added a `.coingecko_cache.json` file with a **5-minute TTL**:

- `get_cached_prices()` — reads cache if it exists and is still fresh
- `save_prices_to_cache(prices)` — writes cache after a successful API call
- Cache location: `output/.coingecko_cache.json` (same directory as the script)

### 2. Exponential Backoff Retry

Replaced the simple retry loop with `fetch_prices_with_retry()`:

- **Max retries:** 3
- **Base delay:** 2 seconds
- **Backoff:** `delay = base_delay * (2 ** attempt)`
- **429 handling:** Detects rate-limit status code explicitly, sleeps, then retries
- **Network errors:** Catches `requests.exceptions.RequestException` and retries

### 3. Integration with Existing Flow

`fetch_crypto_prices()` now:
1. Checks cache first
2. If cache miss, calls `fetch_prices_with_retry()`
3. Saves successful API response to cache
4. Returns parsed BTC/ETH prices

The `--json` flag behavior is unchanged — JSON signals are still emitted at the end of stdout for `crypto_edge.js` consumption.

## Test Results

### Run 1 (Cache Miss)

```
[1/4] Fetching live BTC/ETH prices from CoinGecko...
      BTC: $66,560.00
      ETH: $2,046.81
```

Cache file created: `output/.coingecko_cache.json`

### Run 2 (Cache Hit)

```
[1/4] Fetching live BTC/ETH prices from CoinGecko...
[CoinGecko] Using cached prices.
      BTC: $66,560.00
      ETH: $2,046.81
```

✅ Second run used cached prices — no CoinGecko API call.

### JSON Output Verification

```bash
python output/crypto_edge_analysis.py --json
```

Output: 7 valid signals, JSON parseable by `crypto_edge.js`.

## Impact

- **Before:** Every pipeline run hit CoinGecko → 429 errors after 2-3 runs
- **After:** Only 1 API call every 5 minutes → pipeline runs are stable and fast
- **Fallback:** If cache is stale and API is rate-limited, exponential backoff gives CoinGecko time to reset limits

## Files Modified

- `output/crypto_edge_analysis.py`

## No Changes Needed To

- `bob/backend/strategies/strategies/crypto_edge.js` — already handles mixed stdout correctly and benefits from the cache automatically
