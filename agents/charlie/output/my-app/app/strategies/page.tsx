'use client';

import { useEffect, useState } from 'react';
import { Strategy, PnLReport } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Zap, Play, Pause, Square, TrendingUp, TrendingDown, Activity, Target, BarChart3, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getStrategies, updateStrategyStatus, getStrategyFullReport, getStrategyPerformance } from '@/lib/api/strategies';
import { mockStrategies, mockStrategyPnL } from '@/lib/mockData';

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function formatPercent(val: number) {
  return `${(val * 100).toFixed(1)}%`;
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [pnlMap, setPnLMap] = useState<Record<string, PnLReport>>({});
  const [chartData, setChartData] = useState<{ name: string; data: { day: number; value: number }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const apiStrategies = await getStrategies();
        setStrategies(apiStrategies);

        // Fetch PnL and performance for each strategy
        const pnlResults: Record<string, PnLReport> = {};
        const chartSeries: { name: string; data: { day: number; value: number }[] }[] = [];

        await Promise.all(
          apiStrategies.map(async (s) => {
            try {
              const report = await getStrategyFullReport(s.id);
              pnlResults[s.id] = report;
            } catch {
              // fallback to mock if API errors
            }

            try {
              const perf = await getStrategyPerformance(s.id);
              const data = perf.history.map((h, i) => ({
                day: i + 1,
                value: h.cumulative_pnl / 100,
              }));
              chartSeries.push({ name: s.name, data });
            } catch {
              // fallback: build from mock dailyReturns
              const returns = mockStrategyPnL[s.id]?.dailyReturns || [];
              let cumulative = 0;
              const data = returns.map((r, i) => {
                cumulative += r;
                return { day: i + 1, value: cumulative / 100 };
              });
              chartSeries.push({ name: s.name, data });
            }
          })
        );

        setPnLMap(pnlResults);
        setChartData(chartSeries);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load strategies');
        setStrategies(mockStrategies);
        const fallbackChart = mockStrategies.map((s) => {
          const returns = mockStrategyPnL[s.id]?.dailyReturns || [];
          let cumulative = 0;
          return {
            name: s.name,
            data: returns.map((r, i) => {
              cumulative += r;
              return { day: i + 1, value: cumulative / 100 };
            }),
          };
        });
        setChartData(fallbackChart);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleToggleStatus(strategy: Strategy, nextStatus: 'active' | 'paused' | 'stopped') {
    try {
      const updated = await updateStrategyStatus(strategy.id, nextStatus);
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  }

  // Aggregate stats across all strategies
  const totalRealized = Object.values(pnlMap).reduce((sum, r) => sum + r.totalRealizedPnl, 0);
  const totalUnrealized = Object.values(pnlMap).reduce((sum, r) => sum + r.totalUnrealizedPnl, 0);
  const totalTrades = Object.values(pnlMap).reduce((sum, r) => sum + r.totalTrades, 0);
  const avgSharpe =
    Object.keys(pnlMap).length > 0
      ? Object.values(pnlMap).reduce((sum, r) => sum + r.sharpeRatio, 0) / Object.keys(pnlMap).length
      : 0;
  const maxDd = Math.max(0, ...Object.values(pnlMap).map((r) => r.maxDrawdown));

  const colors = ['#22c55e', '#3b82f6', '#ef4444'];

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Strategy Monitor</h1>
          <p className="text-sm text-text-secondary">Manage automated trading strategies and track performance</p>
        </div>
        <Button>
          <Zap className="mr-2 h-4 w-4" />
          New Strategy
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-no/30 bg-no/10 px-4 py-3 text-sm text-no">
          API Error: {error}. Showing fallback data.
        </div>
      )}

      {/* Aggregate P&L Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary">Total Realized P&L</p>
                <p className={cn('mt-1 text-2xl font-bold', totalRealized >= 0 ? 'text-yes' : 'text-no')}>
                  {totalRealized >= 0 ? '+' : ''}${centsToDollars(totalRealized)}
                </p>
              </div>
              <div className="rounded-lg bg-surface p-2">
                <TrendingUp className="h-5 w-5 text-text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary">Unrealized P&L</p>
                <p className={cn('mt-1 text-2xl font-bold', totalUnrealized >= 0 ? 'text-yes' : 'text-no')}>
                  {totalUnrealized >= 0 ? '+' : ''}${centsToDollars(totalUnrealized)}
                </p>
              </div>
              <div className="rounded-lg bg-surface p-2">
                <Activity className="h-5 w-5 text-text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary">Total Trades</p>
                <p className="mt-1 text-2xl font-bold text-text-primary">{totalTrades}</p>
              </div>
              <div className="rounded-lg bg-surface p-2">
                <BarChart3 className="h-5 w-5 text-text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary">Avg Sharpe / Max DD</p>
                <p className="mt-1 text-2xl font-bold text-text-primary">{avgSharpe.toFixed(2)}</p>
                <p className="mt-0.5 text-xs text-no">-${centsToDollars(maxDd)} max drawdown</p>
              </div>
              <div className="rounded-lg bg-surface p-2">
                <Target className="h-5 w-5 text-text-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strategy Performance Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Strategy Performance</CardTitle>
          <CardDescription>Cumulative P&L over time by strategy</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="day" type="number" allowDuplicatedCategory={false} stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px' }}
                  itemStyle={{ color: '#f8fafc' }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative P&L']}
                />
                {chartData.map((series, idx) => (
                  <Line
                    key={series.name}
                    data={series.data}
                    dataKey="value"
                    name={series.name}
                    stroke={colors[idx % colors.length]}
                    strokeWidth={2}
                    dot={false}
                    type="monotone"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Strategies Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {strategies.map((strategy) => {
          const report = pnlMap[strategy.id] || mockStrategyPnL[strategy.id];
          return (
            <Card key={strategy.id} className={cn(strategy.status === 'stopped' && 'opacity-75')}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{strategy.name}</CardTitle>
                    <CardDescription className="mt-1">{strategy.description}</CardDescription>
                  </div>
                  <Badge
                    variant={
                      strategy.status === 'active' ? 'yes' : strategy.status === 'paused' ? 'outline' : 'secondary'
                    }
                  >
                    {strategy.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Signal Strength */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Signal Strength</span>
                    <span className="font-medium text-text-primary">{Math.round(strategy.signalStrength * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        strategy.signalStrength > 0.7 ? 'bg-yes' : strategy.signalStrength > 0.4 ? 'bg-accent' : 'bg-no'
                      )}
                      style={{ width: `${strategy.signalStrength * 100}%` }}
                    />
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className={cn('text-lg font-bold', strategy.totalPnl >= 0 ? 'text-yes' : 'text-no')}>
                      {strategy.totalPnl >= 0 ? '+' : ''}${strategy.totalPnl.toFixed(0)}
                    </p>
                    <p className="text-xs text-text-secondary">Total P&L</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-text-primary">{strategy.tradesToday}</p>
                    <p className="text-xs text-text-secondary">Trades Today</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-text-primary">{Math.round(strategy.winRate * 100)}%</p>
                    <p className="text-xs text-text-secondary">Win Rate</p>
                  </div>
                </div>

                {/* Extended Stats from PnL Report */}
                {report && (
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Sharpe</span>
                      <span className="font-medium text-text-primary">{report.sharpeRatio.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Max DD</span>
                      <span className="font-medium text-no">-${centsToDollars(report.maxDrawdown)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Realized</span>
                      <span className={cn('font-medium', report.totalRealizedPnl >= 0 ? 'text-yes' : 'text-no')}>
                        {report.totalRealizedPnl >= 0 ? '+' : ''}${centsToDollars(report.totalRealizedPnl)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Unrealized</span>
                      <span className={cn('font-medium', report.totalUnrealizedPnl >= 0 ? 'text-yes' : 'text-no')}>
                        {report.totalUnrealizedPnl >= 0 ? '+' : ''}${centsToDollars(report.totalUnrealizedPnl)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  {strategy.status === 'active' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleToggleStatus(strategy, 'paused')}
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      Pause
                    </Button>
                  ) : strategy.status === 'paused' ? (
                    <Button
                      variant="yes"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleToggleStatus(strategy, 'active')}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Resume
                    </Button>
                  ) : (
                    <Button
                      variant="yes"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleToggleStatus(strategy, 'active')}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Start
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleToggleStatus(strategy, 'stopped')}>
                    <Square className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
