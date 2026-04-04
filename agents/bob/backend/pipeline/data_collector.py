#!/usr/bin/env python3
"""
Kalshi Data Collector Pipeline
Author: Bob (Backend Engineer)
Task: #219 — Build Kalshi API client and data infrastructure

Fetches market data from Kalshi API and stores in PostgreSQL.
Designed to run as scheduled jobs (cron, Celery, or similar).
"""

import os
import sys
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from dataclasses import dataclass
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import execute_values, Json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class Config:
    """Pipeline configuration from environment variables"""
    
    # Database
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: int = int(os.getenv("DB_PORT", "5432"))
    db_name: str = os.getenv("DB_NAME", "kalshi_trading")
    db_user: str = os.getenv("DB_USER", "postgres")
    db_password: str = os.getenv("DB_PASSWORD", "")
    
    # Kalshi API
    kalshi_api_key: str = os.getenv("KALSHI_API_KEY", "")
    kalshi_demo: bool = os.getenv("KALSHI_DEMO", "true").lower() == "true"
    
    # Collection settings
    batch_size: int = int(os.getenv("BATCH_SIZE", "100"))
    price_history_days: int = int(os.getenv("PRICE_HISTORY_DAYS", "7"))


# ---------------------------------------------------------------------------
# Database Connection
# ---------------------------------------------------------------------------

@contextmanager
def get_db_connection(config: Config):
    """Get a database connection as a context manager"""
    conn = None
    try:
        conn = psycopg2.connect(
            host=config.db_host,
            port=config.db_port,
            dbname=config.db_name,
            user=config.db_user,
            password=config.db_password,
        )
        yield conn
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        raise
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Kalshi API Client (Python)
# ---------------------------------------------------------------------------

import urllib.request
import urllib.error


class KalshiAPIClient:
    """Simple Python client for Kalshi API"""
    
    BASE_URL = "https://trading-api.kalshi.com/v1"
    DEMO_URL = "https://demo-api.kalshi.com/v1"
    
    def __init__(self, api_key: str, demo: bool = True):
        self.api_key = api_key
        self.demo = demo
        self.base_url = self.DEMO_URL if demo else self.BASE_URL
        
        if not api_key:
            raise ValueError("KALSHI_API_KEY is required")
    
    def _request(self, method: str, path: str, **kwargs) -> Dict[str, Any]:
        """Make an authenticated API request"""
        url = f"{self.base_url}{path}"
        
        if kwargs.get("params"):
            params = urllib.parse.urlencode(kwargs["params"])
            url = f"{url}?{params}"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        
        req = urllib.request.Request(url, method=method, headers=headers)
        
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read().decode("utf-8")
                return json.loads(data) if data else {}
        except urllib.error.HTTPError as e:
            logger.error(f"HTTP Error {e.code}: {e.read().decode()}")
            raise
        except Exception as e:
            logger.error(f"Request error: {e}")
            raise
    
    def get_markets(self, status: str = "active", limit: int = 100, cursor: Optional[str] = None) -> Dict:
        """Fetch markets from Kalshi"""
        params = {"status": status, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        return self._request("GET", "/markets", params=params)
    
    def get_market(self, ticker: str) -> Dict:
        """Fetch a specific market"""
        return self._request("GET", f"/markets/{ticker}")
    
    def get_orderbook(self, ticker: str, depth: int = 10) -> Dict:
        """Fetch market orderbook"""
        return self._request("GET", f"/markets/{ticker}/orderbook", params={"depth": depth})
    
    def get_candles(self, ticker: str, resolution: str = "1d", from_ts: Optional[int] = None, to_ts: Optional[int] = None) -> Dict:
        """Fetch price candles"""
        params = {"resolution": resolution}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return self._request("GET", f"/markets/{ticker}/candles", params=params)
    
    def get_account(self) -> Dict:
        """Fetch account info"""
        return self._request("GET", "/account")
    
    def get_balance(self) -> Dict:
        """Fetch account balance"""
        return self._request("GET", "/account/balance")
    
    def get_positions(self, limit: int = 100, cursor: Optional[str] = None) -> Dict:
        """Fetch positions"""
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        return self._request("GET", "/positions", params=params)


# ---------------------------------------------------------------------------
# Data Collection Jobs
# ---------------------------------------------------------------------------

class DataCollector:
    """Main data collection orchestrator"""
    
    def __init__(self, config: Config):
        self.config = config
        self.api = KalshiAPIClient(config.kalshi_api_key, config.kalshi_demo)
    
    def _log_job_start(self, conn, job_type: str, params: Optional[Dict] = None) -> str:
        """Log job start and return job ID"""
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_collection_jobs (job_type, status, params)
                VALUES (%s, 'running', %s)
                RETURNING id
                """,
                (job_type, Json(params) if params else None),
            )
            job_id = cur.fetchone()[0]
            conn.commit()
            return job_id
    
    def _log_job_complete(self, conn, job_id: str, status: str, 
                          records_processed: int = 0, records_inserted: int = 0,
                          records_updated: int = 0, error_message: Optional[str] = None):
        """Log job completion"""
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE data_collection_jobs
                SET status = %s,
                    records_processed = %s,
                    records_inserted = %s,
                    records_updated = %s,
                    completed_at = NOW(),
                    error_message = %s
                WHERE id = %s
                """,
                (status, records_processed, records_inserted, records_updated, error_message, job_id),
            )
            conn.commit()
    
    def collect_markets(self) -> Dict[str, int]:
        """Fetch and store all active markets"""
        logger.info("Starting market collection...")
        
        with get_db_connection(self.config) as conn:
            job_id = self._log_job_start(conn, "markets")
            
            try:
                all_markets = []
                cursor = None
                
                # Fetch all markets with pagination
                while True:
                    response = self.api.get_markets(status="active", limit=100, cursor=cursor)
                    markets = response.get("markets", [])
                    all_markets.extend(markets)
                    
                    cursor = response.get("cursor")
                    if not cursor or not markets:
                        break
                
                logger.info(f"Fetched {len(all_markets)} markets from API")
                
                # Upsert markets into database
                inserted = 0
                updated = 0
                
                with conn.cursor() as cur:
                    for market in all_markets:
                        # Map Kalshi fields to our schema
                        cur.execute(
                            """
                            INSERT INTO markets (
                                ticker, title, description, category, series_ticker, event_ticker,
                                status, open_date, close_date, settlement_date,
                                yes_sub_title, no_sub_title, rules_primary, rules_secondary,
                                kalshi_market_id, updated_at
                            ) VALUES (
                                %s, %s, %s, %s, %s, %s,
                                %s, %s, %s, %s,
                                %s, %s, %s, %s,
                                %s, NOW()
                            )
                            ON CONFLICT (ticker) DO UPDATE SET
                                title = EXCLUDED.title,
                                description = EXCLUDED.description,
                                category = EXCLUDED.category,
                                status = EXCLUDED.status,
                                close_date = EXCLUDED.close_date,
                                settlement_date = EXCLUDED.settlement_date,
                                yes_sub_title = EXCLUDED.yes_sub_title,
                                no_sub_title = EXCLUDED.no_sub_title,
                                updated_at = NOW()
                            RETURNING (xmax = 0) as inserted
                            """,
                            (
                                market.get("ticker"),
                                market.get("title"),
                                market.get("description"),
                                market.get("category"),
                                market.get("series_ticker"),
                                market.get("event_ticker"),
                                market.get("status", "active"),
                                market.get("open_date"),
                                market.get("close_date"),
                                market.get("settlement_date"),
                                market.get("yes_sub_title"),
                                market.get("no_sub_title"),
                                market.get("rules_primary"),
                                market.get("rules_secondary"),
                                market.get("id"),
                            ),
                        )
                        result = cur.fetchone()
                        if result and result[0]:
                            inserted += 1
                        else:
                            updated += 1
                
                conn.commit()
                
                self._log_job_complete(
                    conn, job_id, "success",
                    records_processed=len(all_markets),
                    records_inserted=inserted,
                    records_updated=updated,
                )
                
                logger.info(f"Markets: {inserted} inserted, {updated} updated")
                return {"processed": len(all_markets), "inserted": inserted, "updated": updated}
                
            except Exception as e:
                logger.error(f"Market collection failed: {e}")
                self._log_job_complete(conn, job_id, "failed", error_message=str(e))
                raise
    
    def collect_prices(self, ticker: Optional[str] = None) -> Dict[str, int]:
        """Fetch and store current prices for markets"""
        logger.info("Starting price collection...")
        
        with get_db_connection(self.config) as conn:
            job_id = self._log_job_start(conn, "prices", {"ticker": ticker})
            
            try:
                # Get markets to fetch prices for
                with conn.cursor() as cur:
                    if ticker:
                        cur.execute("SELECT id, ticker FROM markets WHERE ticker = %s AND status = 'active'", (ticker,))
                    else:
                        cur.execute("SELECT id, ticker FROM markets WHERE status = 'active'")
                    markets = cur.fetchall()
                
                logger.info(f"Fetching prices for {len(markets)} markets")
                
                prices_inserted = 0
                errors = 0
                
                with conn.cursor() as cur:
                    for market_id, market_ticker in markets:
                        try:
                            # Fetch market data (includes current prices)
                            response = self.api.get_market(market_ticker)
                            market_data = response.get("market", {})
                            
                            # Insert price record
                            cur.execute(
                                """
                                INSERT INTO market_prices (
                                    market_id, yes_bid, yes_ask, no_bid, no_ask,
                                    volume, open_interest, last_trade_price,
                                    kalshi_timestamp, source
                                ) VALUES (
                                    %s, %s, %s, %s, %s,
                                    %s, %s, %s,
                                    %s, 'api'
                                )
                                """,
                                (
                                    market_id,
                                    market_data.get("yes_bid"),
                                    market_data.get("yes_ask"),
                                    market_data.get("no_bid"),
                                    market_data.get("no_ask"),
                                    market_data.get("volume"),
                                    market_data.get("open_interest"),
                                    market_data.get("last_trade_price"),
                                    market_data.get("last_updated_at"),
                                ),
                            )
                            prices_inserted += 1
                            
                        except Exception as e:
                            logger.warning(f"Failed to fetch price for {market_ticker}: {e}")
                            errors += 1
                            continue
                
                conn.commit()
                
                self._log_job_complete(
                    conn, job_id, "success",
                    records_processed=len(markets),
                    records_inserted=prices_inserted,
                )
                
                logger.info(f"Prices: {prices_inserted} inserted, {errors} errors")
                return {"processed": len(markets), "inserted": prices_inserted, "errors": errors}
                
            except Exception as e:
                logger.error(f"Price collection failed: {e}")
                self._log_job_complete(conn, job_id, "failed", error_message=str(e))
                raise
    
    def collect_candles(self, ticker: str, resolution: str = "1d", days: int = 7) -> Dict[str, int]:
        """Fetch and store price candles for a market"""
        logger.info(f"Starting candle collection for {ticker} ({resolution})...")
        
        with get_db_connection(self.config) as conn:
            job_id = self._log_job_start(conn, "candles", {"ticker": ticker, "resolution": resolution, "days": days})
            
            try:
                # Get market ID
                with conn.cursor() as cur:
                    cur.execute("SELECT id FROM markets WHERE ticker = %s", (ticker,))
                    result = cur.fetchone()
                    if not result:
                        raise ValueError(f"Market not found: {ticker}")
                    market_id = result[0]
                
                # Calculate time range
                to_ts = int(datetime.now().timestamp() * 1000)
                from_ts = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
                
                # Fetch candles
                response = self.api.get_candles(ticker, resolution, from_ts, to_ts)
                candles = response.get("candles", [])
                
                logger.info(f"Fetched {len(candles)} candles")
                
                # Insert candles
                inserted = 0
                with conn.cursor() as cur:
                    for candle in candles:
                        try:
                            cur.execute(
                                """
                                INSERT INTO price_candles (
                                    market_id, resolution, candle_time,
                                    yes_open, yes_high, yes_low, yes_close, yes_volume,
                                    no_open, no_high, no_low, no_close, no_volume
                                ) VALUES (
                                    %s, %s, to_timestamp(%s / 1000.0),
                                    %s, %s, %s, %s, %s,
                                    %s, %s, %s, %s, %s
                                )
                                ON CONFLICT (market_id, resolution, candle_time) DO NOTHING
                                """,
                                (
                                    market_id,
                                    resolution,
                                    candle.get("time"),
                                    candle.get("yes_open"),
                                    candle.get("yes_high"),
                                    candle.get("yes_low"),
                                    candle.get("yes_close"),
                                    candle.get("yes_volume"),
                                    candle.get("no_open"),
                                    candle.get("no_high"),
                                    candle.get("no_low"),
                                    candle.get("no_close"),
                                    candle.get("no_volume"),
                                ),
                            )
                            if cur.rowcount > 0:
                                inserted += 1
                        except Exception as e:
                            logger.warning(f"Failed to insert candle: {e}")
                            continue
                
                conn.commit()
                
                self._log_job_complete(
                    conn, job_id, "success",
                    records_processed=len(candles),
                    records_inserted=inserted,
                )
                
                logger.info(f"Candles: {inserted} inserted")
                return {"processed": len(candles), "inserted": inserted}
                
            except Exception as e:
                logger.error(f"Candle collection failed: {e}")
                self._log_job_complete(conn, job_id, "failed", error_message=str(e))
                raise
    
    def collect_positions(self) -> Dict[str, int]:
        """Fetch and store current positions"""
        logger.info("Starting position collection...")
        
        with get_db_connection(self.config) as conn:
            job_id = self._log_job_start(conn, "positions")
            
            try:
                all_positions = []
                cursor = None
                
                # Fetch all positions with pagination
                while True:
                    response = self.api.get_positions(limit=100, cursor=cursor)
                    positions = response.get("positions", [])
                    all_positions.extend(positions)
                    
                    cursor = response.get("cursor")
                    if not cursor or not positions:
                        break
                
                logger.info(f"Fetched {len(all_positions)} positions from API")
                
                # Insert/update positions
                inserted = 0
                updated = 0
                
                with conn.cursor() as cur:
                    for pos in all_positions:
                        # Get market ID
                        ticker = pos.get("market_id")  # Kalshi calls it market_id but it's the ticker
                        cur.execute("SELECT id FROM markets WHERE ticker = %s", (ticker,))
                        result = cur.fetchone()
                        if not result:
                            logger.warning(f"Market not found for position: {ticker}")
                            continue
                        market_id = result[0]
                        
                        # Insert or update position
                        cur.execute(
                            """
                            INSERT INTO positions (
                                market_id, side, contracts, avg_entry_price,
                                current_price, status, opened_at
                            ) VALUES (
                                %s, %s, %s, %s,
                                %s, %s, NOW()
                            )
                            ON CONFLICT (market_id, side) DO UPDATE SET
                                contracts = EXCLUDED.contracts,
                                avg_entry_price = EXCLUDED.avg_entry_price,
                                current_price = EXCLUDED.current_price,
                                status = EXCLUDED.status
                            RETURNING (xmax = 0) as inserted
                            """,
                            (
                                market_id,
                                pos.get("side"),
                                pos.get("position"),
                                pos.get("avg_price"),
                                pos.get("last_price"),
                                "open" if pos.get("position", 0) > 0 else "closed",
                            ),
                        )
                        result = cur.fetchone()
                        if result and result[0]:
                            inserted += 1
                        else:
                            updated += 1
                
                conn.commit()
                
                self._log_job_complete(
                    conn, job_id, "success",
                    records_processed=len(all_positions),
                    records_inserted=inserted,
                    records_updated=updated,
                )
                
                logger.info(f"Positions: {inserted} inserted, {updated} updated")
                return {"processed": len(all_positions), "inserted": inserted, "updated": updated}
                
            except Exception as e:
                logger.error(f"Position collection failed: {e}")
                self._log_job_complete(conn, job_id, "failed", error_message=str(e))
                raise


# ---------------------------------------------------------------------------
# CLI Interface
# ---------------------------------------------------------------------------

def main():
    """CLI entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Kalshi Data Collector")
    parser.add_argument("command", choices=["markets", "prices", "candles", "positions", "all"])
    parser.add_argument("--ticker", help="Market ticker (for candles)")
    parser.add_argument("--resolution", default="1d", help="Candle resolution")
    parser.add_argument("--days", type=int, default=7, help="Days of history")
    
    args = parser.parse_args()
    
    config = Config()
    collector = DataCollector(config)
    
    if args.command == "markets" or args.command == "all":
        collector.collect_markets()
    
    if args.command == "prices" or args.command == "all":
        collector.collect_prices()
    
    if args.command == "candles":
        if not args.ticker:
            print("Error: --ticker required for candles command")
            sys.exit(1)
        collector.collect_candles(args.ticker, args.resolution, args.days)
    
    if args.command == "positions" or args.command == "all":
        collector.collect_positions()
    
    logger.info("Done!")


if __name__ == "__main__":
    main()
