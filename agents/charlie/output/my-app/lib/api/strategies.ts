import { Strategy, PnLReport } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

export interface ApiStrategy {
  id: string;
  name: string;
  description: string;
  strategy_type: string;
  strategyType?: string; // camelCase fallback
  status: 'active' | 'paused' | 'stopped';
  total_trades: number;
  totalTrades?: number;
  winning_trades: number;
  winningTrades?: number;
  losing_trades: number;
  losingTrades?: number;
  total_pnl: number; // cents
  totalPnl?: number;
  win_rate: number;
  winRate?: number;
  signal_strength: number;
  signalStrength?: number;
  trades_today: number;
  tradesToday?: number;
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
}

export interface ApiPnLResponse {
  strategyId: string;
  pnl: {
    realized: number; // cents
    unrealized: number; // cents
    total: number; // cents
  };
  winRate: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
  };
  tradesToday: number;
}

export interface ApiPerformance {
  history: {
    id: string;
    strategy_id: string;
    period: string;
    period_start: string;
    trades_count: number;
    realized_pnl: number;
    unrealized_pnl: number;
    total_pnl: number;
    win_rate: number;
    cumulative_pnl: number;
  }[];
}

export interface ApiSignal {
  id: string;
  strategy_id: string;
  market_id: string;
  side: 'yes' | 'no';
  signal_type: string;
  confidence: number;
  target_price: number;
  current_price: number;
  expected_edge: number;
  recommended_contracts: number;
  reason: string;
  acted_on: boolean;
  generated_at: string;
}

function mapApiStrategy(s: ApiStrategy): Strategy {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.status,
    signalStrength: s.signal_strength ?? s.signalStrength ?? 0,
    totalPnl: (s.total_pnl ?? s.totalPnl ?? 0) / 100,
    tradesToday: s.trades_today ?? s.tradesToday ?? 0,
    winRate: s.win_rate ?? s.winRate ?? 0,
    strategyType: s.strategy_type ?? s.strategyType,
    config: (s as unknown as Record<string, unknown>).config as Record<string, unknown> | undefined,
    maxPositionSize: (s as unknown as Record<string, unknown>).max_position_size as number | undefined,
    maxDailyLoss: (s as unknown as Record<string, unknown>).max_daily_loss as number | undefined,
    maxExposure: (s as unknown as Record<string, unknown>).max_exposure as number | undefined,
    createdAt: s.created_at ?? s.createdAt,
    updatedAt: s.updated_at ?? s.updatedAt,
  };
}

function sharpe(returns: number[]) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : mean / std;
}

function maxDrawdownFromCumulative(cumulative: number[]) {
  if (cumulative.length === 0) return 0;
  let peak = cumulative[0];
  let maxDd = 0;
  for (const val of cumulative) {
    if (val > peak) peak = val;
    const dd = peak - val;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function buildPnLReport(pnl: ApiPnLResponse, perf: ApiPerformance): PnLReport {
  const dailyReturns = perf.history.map((h) => h.total_pnl);
  const cumulative = perf.history.map((h) => h.cumulative_pnl);
  return {
    totalTrades: pnl.winRate.totalTrades,
    winningTrades: pnl.winRate.winningTrades,
    losingTrades: pnl.winRate.losingTrades,
    winRate: pnl.winRate.winRate,
    totalRealizedPnl: pnl.pnl.realized,
    totalUnrealizedPnl: pnl.pnl.unrealized,
    sharpeRatio: sharpe(dailyReturns),
    maxDrawdown: maxDrawdownFromCumulative(cumulative),
    dailyReturns,
  };
}

export async function getStrategies(): Promise<Strategy[]> {
  const data = await fetchJson<{ strategies: ApiStrategy[] }>(`${API_BASE}/api/strategies`);
  return data.strategies.map(mapApiStrategy);
}

export async function getStrategy(id: string): Promise<Strategy> {
  const data = await fetchJson<{ strategy: ApiStrategy }>(`${API_BASE}/api/strategies/${id}`);
  return mapApiStrategy(data.strategy);
}

export async function updateStrategyStatus(
  id: string,
  status: 'active' | 'paused' | 'stopped'
): Promise<Strategy> {
  const data = await fetchJson<{ strategy: ApiStrategy }>(`${API_BASE}/api/strategies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return mapApiStrategy(data.strategy);
}

export async function updateStrategy(
  id: string,
  updates: Partial<{
    status: 'active' | 'paused' | 'stopped';
    name: string;
    description: string;
    config: Record<string, unknown>;
    maxPositionSize: number;
    maxDailyLoss: number;
    maxExposure: number;
  }>
): Promise<Strategy> {
  const data = await fetchJson<{ strategy: ApiStrategy }>(`${API_BASE}/api/strategies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return mapApiStrategy(data.strategy);
}

export async function getStrategyPnL(id: string): Promise<ApiPnLResponse> {
  return fetchJson<ApiPnLResponse>(`${API_BASE}/api/strategies/${id}/pnl`);
}

export async function getStrategyPerformance(id: string): Promise<ApiPerformance> {
  const data = await fetchJson<ApiPerformance>(`${API_BASE}/api/strategies/${id}/performance`);
  // Ensure history is ascending by period_start for charts
  if (data.history) {
    data.history = data.history.slice().sort(
      (a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime()
    );
  }
  return data;
}

export async function getStrategyFullReport(id: string): Promise<PnLReport> {
  const [pnl, perf] = await Promise.all([getStrategyPnL(id), getStrategyPerformance(id)]);
  return buildPnLReport(pnl, perf);
}

export async function getStrategySignals(id: string): Promise<ApiSignal[]> {
  const data = await fetchJson<{ signals: ApiSignal[] }>(`${API_BASE}/api/strategies/${id}/signals`);
  return data.signals;
}

export async function getStrategyReports(): Promise<Record<string, PnLReport>> {
  const data = await fetchJson<{ reports: Record<string, PnLReport> }>(`${API_BASE}/api/strategies/reports`);
  return data.reports;
}

export async function getAggregatePnL(): Promise<PnLReport> {
  const data = await fetchJson<{ report: PnLReport }>(`${API_BASE}/api/strategies/pnl`);
  return data.report;
}
