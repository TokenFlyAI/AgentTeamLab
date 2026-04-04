'use client';

import { useEffect, useState } from 'react';
import { Strategy, PnLReport } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { Loader2, TrendingUp, TrendingDown, Target, Activity, BarChart3, PieChart } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import {
  getStrategies,
  getStrategyReports,
  getAggregatePnL,
  getStrategyPerformance,
} from '@/lib/api/strategies';
import { mockStrategies, mockStrategyPnL } from '@/lib/mockData';

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function PnLPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [reports, setReports] = useState<Record<string, PnLReport>>({});
  const [aggregate, setAggregate] = useState<PnLReport | null>(null);
  const [cumulativeData, setCumulativeData] = useState<{ day: number; [key: string]: number }[]>([]);
  const [dailyData, setDailyData] = useState<{ day: number; [key: string]: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [apiStrategies, apiReports, apiAggregate] = await Promise.all([
          getStrategies(),
          getStrategyReports().catch(() => ({} as Record<string, PnLReport>)),
          getAggregatePnL().catch(() => null),
        ]);

        setStrategies(apiStrategies);
        setReports(apiReports);
        setAggregate(apiAggregate);

        // Fetch performance history for charts
        const perfResults = await Promise.all(
          apiStrategies.map(async (s) => {
            try {
              const perf = await getStrategyPerformance(s.id);
              return { name: s.name, history: perf.history };
            } catch {
              // fallback to mock
              const returns = mockStrategyPnL[s.id]?.dailyReturns || [];
              let cumulative = 0;
              const history = returns.map((r) => {
                cumulative += r;
                return { cumulative_pnl: cumulative, total_pnl: r };
              });
              return { name: s.name, history };
            }
          })
        );

        // Build cumulative chart data
        const maxLen = Math.max(...perfResults.map((p) => p.history.length), 0);
        const cumData: { day: number; [key: string]: number }[] = [];
        const dayData: { day: number; [key: string]: number }[] = [];
        for (let i = 0; i < maxLen; i++) {
          const cumRow: { day: number; [key: string]: number } = { day: i + 1 };
          const dayRow: { day: number; [key: string]: number } = { day: i + 1 };
          for (const p of perfResults) {
            const val = p.history[i]?.cumulative_pnl ?? (i > 0 ? cumRow[p.name] : 0);
            cumRow[p.name] = val / 100;
            dayRow[p.name] = (p.history[i]?.total_pnl ?? 0) / 100;
          }
          cumData.push(cumRow);
          dayData.push(dayRow);
        }
        setCumulativeData(cumData);
        setDailyData(dayData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load P&L data');
        setStrategies(mockStrategies);
        setReports(mockStrategyPnL);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const colors = ['#22c55e', '#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'];

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  const totalRealized = aggregate?.totalRealizedPnl ?? Object.values(reports).reduce((s, r) => s + r.totalRealizedPnl, 0);
  const totalUnrealized = aggregate?.totalUnrealizedPnl ?? Object.values(reports).reduce((s, r) => s + r.totalUnrealizedPnl, 0);
  const totalTrades = aggregate?.totalTrades ?? Object.values(reports).reduce((s, r) => s + r.totalTrades, 0);
  const avgSharpe =
    Object.keys(reports).length > 0
      ? Object.values(reports).reduce((s, r) => s + r.sharpeRatio, 0) / Object.keys(reports).length
      : 0;
  const maxDd = Math.max(0, ...Object.values(reports).map((r) => r.maxDrawdown));

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">P&L Tracking</h1>
        <p className="text-sm text-text-secondary">Daily performance, cumulative returns, and win/loss breakdown by strategy</p>
      </div>

      {error && (
        <div className="rounded-lg border border-no/30 bg-no/10 px-4 py-3 text-sm text-no">
          API Error: {error}. Showing fallback data.
        </div>
      )}

      {/* Aggregate Stats */}
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

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cumulative Returns */}
        <Card>
          <CardHeader>
            <CardTitle>Cumulative Returns</CardTitle>
            <CardDescription>Total P&L over time by strategy</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="day" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px' }}
                    itemStyle={{ color: '#f8fafc' }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative P&L']}
                  />
                  <Legend />
                  {strategies.map((s, idx) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.name}
                      stroke={colors[idx % colors.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Daily P&L */}
        <Card>
          <CardHeader>
            <CardTitle>Daily P&L</CardTitle>
            <CardDescription>Per-day realized + unrealized changes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="day" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px' }}
                    itemStyle={{ color: '#f8fafc' }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, 'Daily P&L']}
                  />
                  <Legend />
                  {strategies.map((s, idx) => (
                    <Bar key={s.id} dataKey={s.name} fill={colors[idx % colors.length]} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strategy Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            Strategy Breakdown
          </CardTitle>
          <CardDescription>Win/loss ratio, Sharpe, and drawdown per strategy</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="pb-3 font-medium">Strategy</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Trades</th>
                  <th className="pb-3 font-medium text-right">Win Rate</th>
                  <th className="pb-3 font-medium text-right">Realized P&L</th>
                  <th className="pb-3 font-medium text-right">Unrealized P&L</th>
                  <th className="pb-3 font-medium text-right">Sharpe</th>
                  <th className="pb-3 font-medium text-right">Max DD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {strategies.map((s) => {
                  const r = reports[s.id];
                  return (
                    <tr key={s.id} className="group">
                      <td className="py-3 font-medium text-text-primary">{s.name}</td>
                      <td className="py-3">
                        <Badge
                          variant={
                            s.status === 'active' ? 'yes' : s.status === 'paused' ? 'outline' : 'secondary'
                          }
                        >
                          {s.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-right text-text-primary">{r?.totalTrades ?? '-'}</td>
                      <td className="py-3 text-right text-text-primary">
                        {r ? `${(r.winRate * 100).toFixed(1)}%` : '-'}
                      </td>
                      <td className={cn('py-3 text-right font-medium', r && r.totalRealizedPnl >= 0 ? 'text-yes' : 'text-no')}>
                        {r ? `${r.totalRealizedPnl >= 0 ? '+' : ''}$${centsToDollars(r.totalRealizedPnl)}` : '-'}
                      </td>
                      <td className={cn('py-3 text-right font-medium', r && r.totalUnrealizedPnl >= 0 ? 'text-yes' : 'text-no')}>
                        {r ? `${r.totalUnrealizedPnl >= 0 ? '+' : ''}$${centsToDollars(r.totalUnrealizedPnl)}` : '-'}
                      </td>
                      <td className="py-3 text-right text-text-primary">{r ? r.sharpeRatio.toFixed(2) : '-'}</td>
                      <td className="py-3 text-right text-no">{r ? `-$${centsToDollars(r.maxDrawdown)}` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
