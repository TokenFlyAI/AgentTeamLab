#!/usr/bin/env python3
"""
Backtest Runner

Generates historical data, runs all strategies, and outputs performance report.
"""

import json
from pathlib import Path
from data_generator import generate_market_history, save_data
from engine import BacktestEngine


def format_currency(cents: float) -> str:
    return f"${cents / 100:,.2f}"


def generate_report(results: dict, output_path: str = "backtest_results.md"):
    # Sort by Sharpe ratio (descending) for ranking
    sorted_results = sorted(results.items(), key=lambda x: x[1].sharpe_ratio, reverse=True)
    
    lines = [
        "# Strategy Rankings by Sharpe Ratio",
        "",
        "**Generated:** 2026-04-01  ",
        "**Data:** 90 days of synthetic historical market data (14 markets, daily snapshots)  ",
        "**Hold Period:** 5 days per trade  ",
        "**Account Balance:** $1,000.00 (100,000 cents)  ",
        "",
        "## Rankings (by Sharpe Ratio)",
        "",
        "| Rank | Strategy | Trades | Win Rate | Total P&L | Sharpe | Max Drawdown |",
        "|------|----------|--------|----------|-----------|--------|--------------|",
    ]
    
    for rank, (name, result) in enumerate(sorted_results, 1):
        lines.append(
            f"| {rank} | {name} | {result.total_trades} | {result.win_rate:.1%} | "
            f"{format_currency(result.total_pnl)} | {result.sharpe_ratio:.3f} | {format_currency(result.max_drawdown)} |"
        )
    
    lines.extend([
        "",
        "## All Strategies Summary (Alphabetical)",
        "",
        "| Strategy | Trades | Win Rate | Total P&L | Avg Trade | Sharpe | Max Drawdown |",
        "|----------|--------|----------|-----------|-----------|--------|--------------|",
    ])
    
    for name, result in sorted(results.items()):
        lines.append(
            f"| {name} | {result.total_trades} | {result.win_rate:.1%} | "
            f"{format_currency(result.total_pnl)} | {format_currency(result.avg_trade_pnl)} | "
            f"{result.sharpe_ratio:.3f} | {format_currency(result.max_drawdown)} |"
        )
    
    lines.extend([
        "",
        "## Strategy Details",
        "",
    ])
    
    for name, result in sorted(results.items()):
        lines.extend([
            f"### {name}",
            "",
            f"- **Total Trades:** {result.total_trades}",
            f"- **Winning Trades:** {result.winning_trades}",
            f"- **Losing Trades:** {result.losing_trades}",
            f"- **Win Rate:** {result.win_rate:.1%}",
            f"- **Total P&L:** {format_currency(result.total_pnl)}",
            f"- **Average Trade P&L:** {format_currency(result.avg_trade_pnl)}",
            f"- **Sharpe Ratio:** {result.sharpe_ratio:.3f}",
            f"- **Max Drawdown:** {format_currency(result.max_drawdown)}",
            "",
        ])
        
        if result.trades:
            lines.append("#### Sample Trades")
            lines.append("")
            lines.append("| Market | Side | Entry | Exit | Contracts | P&L |")
            lines.append("|--------|------|-------|------|-----------|-----|")
            for trade in result.trades[:5]:
                lines.append(
                    f"| {trade.market_id} | {trade.side.upper()} | {trade.entry_price}c | "
                    f"{trade.exit_price}c | {trade.contracts} | {format_currency(trade.pnl)} |"
                )
            lines.append("")
    
    lines.extend([
        "## Methodology",
        "",
        "1. **Data Generation:** Synthetic daily market snapshots for 14 Kalshi-style markets across Economics, Crypto, Politics, Weather, Entertainment, and Financial categories.",
        "2. **Signal Generation:** Each strategy's Python-ported logic scans every market/day and generates entry signals when thresholds are met.",
        "3. **Trade Simulation:** On signal entry, the engine simulates buying/selling at the day's mid price and exits after a 5-day hold period.",
        "4. **P&L Calculation:** Profit/Loss = (exit_price - entry_price) × contracts. For NO positions, NO mid prices are used.",
        "5. **Metrics:** Sharpe ratio uses trade return percentages; max drawdown tracks cumulative P&L peaks.",
        "",
        "## Notes",
        "",
        "- These results use **synthetic data** for infrastructure validation. Live backtests will use actual Kalshi price history from Bob's database pipeline.",
        "- The `economic_momentum` strategy uses mock forecast divergences until real nowcast data is integrated.",
        "- `arbitrage` signals are rare in synthetic data because YES+NO prices are generated to sum to ~100.",
        "",
    ])
    
    Path(output_path).write_text("\n".join(lines))
    print(f"Report written to {output_path}")


def main():
    print("=== Kalshi Strategy Backtest Runner ===\n")
    
    # 1. Generate historical data
    markets = generate_market_history(days=90)
    save_data(markets, output_dir="backtest/data")
    
    # 2. Run backtest engine
    engine = BacktestEngine(hold_days=5, account_balance=100000)
    results = engine.run_all_strategies(markets)
    
    # 3. Print summary (sorted by Sharpe)
    print("\n--- Results (Ranked by Sharpe) ---")
    print(f"{'Strategy':<20} {'Trades':>8} {'Win Rate':>10} {'Total P&L':>12} {'Sharpe':>8}")
    print("-" * 65)
    sorted_by_sharpe = sorted(results.items(), key=lambda x: x[1].sharpe_ratio, reverse=True)
    for name, result in sorted_by_sharpe:
        print(
            f"{name:<20} {result.total_trades:>8} {result.win_rate:>9.1%} "
            f"{format_currency(result.total_pnl):>12} {result.sharpe_ratio:>8.3f}"
        )
    
    # 4. Generate markdown report to correct output location
    output_dir = Path("/Users/chenyangcui/Documents/code/aicompany/agents/bob/output")
    output_dir.mkdir(parents=True, exist_ok=True)
    generate_report(results, output_path=str(output_dir / "strategy_rankings.md"))
    
    # 5. Also save raw JSON to correct output location
    raw_results = {
        name: {
            "total_trades": r.total_trades,
            "win_rate": r.win_rate,
            "total_pnl": r.total_pnl,
            "avg_trade_pnl": r.avg_trade_pnl,
            "sharpe_ratio": r.sharpe_ratio,
            "max_drawdown": r.max_drawdown,
            "trades": [
                {
                    "market_id": t.market_id,
                    "side": t.side,
                    "entry_date": t.entry_date,
                    "entry_price": t.entry_price,
                    "exit_date": t.exit_date,
                    "exit_price": t.exit_price,
                    "contracts": t.contracts,
                    "pnl": t.pnl,
                }
                for t in r.trades
            ],
        }
        for name, r in results.items()
    }
    
    # Create summary with rankings
    summary = {
        "generated_at": "2026-04-01",
        "data_period_days": 90,
        "num_markets": len(markets),
        "hold_days": 5,
        "rankings": [
            {
                "rank": rank,
                "strategy": name,
                "sharpe_ratio": r.sharpe_ratio,
                "total_trades": r.total_trades,
                "win_rate": r.win_rate,
                "total_pnl": r.total_pnl,
            }
            for rank, (name, r) in enumerate(sorted_by_sharpe, 1)
        ],
        "strategies": raw_results,
    }
    
    with open(output_dir / "backtest_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Summary written to {output_dir / 'backtest_summary.json'}")


if __name__ == "__main__":
    main()
