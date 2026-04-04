#!/usr/bin/env python3
"""
Backtest Engine

Replays strategies over historical market data and computes performance metrics.
"""

import math
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class Trade:
    market_id: str
    strategy: str
    side: str  # "yes" or "no"
    entry_date: str
    entry_price: float  # in cents
    exit_date: str
    exit_price: float  # in cents
    contracts: int
    pnl: float  # in cents
    
    @property
    def return_pct(self) -> float:
        if self.entry_price == 0:
            return 0
        return (self.exit_price - self.entry_price) / self.entry_price


@dataclass
class StrategyResult:
    strategy: str
    trades: List[Trade] = field(default_factory=list)
    
    @property
    def total_trades(self) -> int:
        return len(self.trades)
    
    @property
    def winning_trades(self) -> int:
        return sum(1 for t in self.trades if t.pnl > 0)
    
    @property
    def losing_trades(self) -> int:
        return sum(1 for t in self.trades if t.pnl <= 0)
    
    @property
    def win_rate(self) -> float:
        if not self.trades:
            return 0
        return self.winning_trades / self.total_trades
    
    @property
    def total_pnl(self) -> float:
        return sum(t.pnl for t in self.trades)
    
    @property
    def avg_trade_pnl(self) -> float:
        if not self.trades:
            return 0
        return self.total_pnl / self.total_trades
    
    @property
    def sharpe_ratio(self) -> float:
        if len(self.trades) < 2:
            return 0
        returns = [t.return_pct for t in self.trades]
        mean_return = sum(returns) / len(returns)
        variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
        std_dev = math.sqrt(variance) if variance > 0 else 0
        if std_dev == 0:
            return 0
        return mean_return / std_dev
    
    @property
    def max_drawdown(self) -> float:
        """Max drawdown in cents."""
        peak = 0
        drawdown = 0
        cumulative = 0
        for trade in self.trades:
            cumulative += trade.pnl
            if cumulative > peak:
                peak = cumulative
            dd = peak - cumulative
            if dd > drawdown:
                drawdown = dd
        return drawdown


class BacktestEngine:
    """Engine that runs strategies over historical data."""
    
    def __init__(self, hold_days: int = 5, account_balance: float = 100000):
        self.hold_days = hold_days
        self.account_balance = account_balance
        self.results: Dict[str, StrategyResult] = {}
    
    def run(
        self,
        markets: List[Dict],
        strategy_name: str,
        signal_generator,
    ) -> StrategyResult:
        """
        Run a single strategy over all markets and days.
        
        signal_generator: callable that takes (market_snapshot, history) -> signal or list of signals
        """
        trades = []
        
        for market in markets:
            history = market.get("history", [])
            for i, snapshot in enumerate(history):
                # Build history up to this point
                past = history[:i+1]
                
                signals = signal_generator(market, snapshot, past)
                if not signals:
                    continue
                if isinstance(signals, dict):
                    signals = [signals]
                
                for signal in signals:
                    if signal.get("signalType") != "entry":
                        continue
                    
                    # Determine exit day
                    exit_idx = min(i + self.hold_days, len(history) - 1)
                    exit_snapshot = history[exit_idx]
                    
                    trade = self._execute_trade(market, snapshot, exit_snapshot, signal)
                    if trade:
                        trades.append(trade)
        
        result = StrategyResult(strategy=strategy_name, trades=trades)
        self.results[strategy_name] = result
        return result
    
    def _execute_trade(self, market: Dict, entry_snapshot: Dict, exit_snapshot: Dict, signal: Dict) -> Optional[Trade]:
        """Simulate a single trade."""
        side = signal["side"]
        contracts = signal.get("recommendedContracts", 10)
        
        if side == "yes":
            entry_price = signal.get("currentPrice", entry_snapshot.get("yes_mid", 50))
            exit_price = exit_snapshot.get("yes_mid", entry_price)
            pnl = (exit_price - entry_price) * contracts
        else:  # no
            entry_price = signal.get("currentPrice", 100 - entry_snapshot.get("yes_mid", 50))
            exit_price = exit_snapshot.get("no_mid", entry_price)
            pnl = (exit_price - entry_price) * contracts
        
        return Trade(
            market_id=market["id"],
            strategy=signal.get("strategy", "unknown"),
            side=side,
            entry_date=entry_snapshot["date"],
            exit_date=exit_snapshot["date"],
            entry_price=entry_price,
            exit_price=exit_price,
            contracts=contracts,
            pnl=pnl,
        )
    
    def run_all_strategies(self, markets: List[Dict]) -> Dict[str, StrategyResult]:
        """Run all built-in strategies and return results."""
        from strategies import (
            SignalEngine, MeanReversionStrategy, MomentumStrategy,
            ArbitrageStrategy, LongshotFadingStrategy, EconomicMomentumStrategy,
            CryptoEdgeStrategy, NFPNowcastStrategy
        )
        
        engine = SignalEngine()
        
        # 1. Mean Reversion
        mr = MeanReversionStrategy()
        def mr_gen(market, snapshot, past):
            signal = mr.generate_signal({**market, **snapshot}, past)
            return signal if engine.validate(signal) else None
        self.run(markets, "mean_reversion", mr_gen)
        
        # 2. Momentum
        mom = MomentumStrategy()
        def mom_gen(market, snapshot, past):
            signal = mom.generate_signal({**market, **snapshot}, past)
            return signal if engine.validate(signal) else None
        self.run(markets, "momentum", mom_gen)
        
        # 3. Arbitrage
        arb = ArbitrageStrategy()
        def arb_gen(market, snapshot, past):
            signals = arb.generate_signals([{**market, **snapshot}])
            return [s for s in signals if engine.validate(s)]
        self.run(markets, "arbitrage", arb_gen)
        
        # 4. Longshot Fading
        ls = LongshotFadingStrategy()
        ls_engine = SignalEngine(min_edge=0.5)  # Longshot edges are smaller by design
        def ls_gen(market, snapshot, past):
            signal = ls.generate_signal({**market, **snapshot})
            return signal if ls_engine.validate(signal) else None
        self.run(markets, "longshot_fading", ls_gen)
        
        # 5. Economic Momentum (inject synthetic forecast data)
        econ = EconomicMomentumStrategy()
        def econ_gen(market, snapshot, past):
            enriched = {**market, **snapshot}
            if market.get("category") in econ.target_categories:
                # Synthetic forecast: random divergence from implied prob
                yes_price = snapshot.get("yes_mid", 50)
                implied = yes_price / 100.0
                forecast_prob = max(0.05, min(0.95, implied + random.uniform(-0.15, 0.15)))
                enriched["forecast"] = {"probability": forecast_prob, "source": "mock_forecast"}
                enriched["hours_to_release"] = random.randint(12, 36)
            signal = econ.generate_signal(enriched)
            return signal if engine.validate(signal) else None
        self.run(markets, "economic_momentum", econ_gen)
        
        # 6. Crypto Edge (inject synthetic crypto edge data for crypto markets)
        crypto = CryptoEdgeStrategy()
        def crypto_gen(market, snapshot, past):
            enriched = {**market, **snapshot}
            ticker = market.get("ticker", "")
            if ticker.startswith("BTCW") or ticker.startswith("ETHW"):
                # Synthetic crypto edge: random model probability
                yes_price = snapshot.get("yes_mid", 50)
                market_prob = yes_price / 100.0
                model_prob = max(0.05, min(0.95, market_prob + random.uniform(-0.25, 0.25)))
                enriched["crypto_edge"] = {"model_probability": model_prob}
            signal = crypto.generate_signal(enriched)
            return signal if engine.validate(signal) else None
        self.run(markets, "crypto_edge", crypto_gen)
        
        # 7. NFP Nowcast (inject synthetic NFP data)
        nfp = NFPNowcastStrategy()
        def nfp_gen(market, snapshot, past):
            enriched = {**market, **snapshot}
            ticker = market.get("ticker", "")
            if ticker.startswith("KXNF"):
                # Synthetic NFP edge
                yes_price = snapshot.get("yes_mid", 50)
                market_prob = yes_price / 100.0
                model_prob = max(0.05, min(0.95, market_prob + random.uniform(-0.20, 0.20)))
                enriched["nfp_nowcast"] = {"model_probability": model_prob}
            signal = nfp.generate_signal(enriched)
            return signal if engine.validate(signal) else None
        self.run(markets, "nfp_nowcast", nfp_gen)
        
        return self.results
