'use client';

import { useEffect, useState } from 'react';
import { Strategy } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';
import { Loader2, Settings2, Save, Square, Clock, Activity, Radio, Zap } from 'lucide-react';
import { getStrategies, updateStrategy, getStrategySignals, ApiSignal } from '@/lib/api/strategies';
import { mockStrategies } from '@/lib/mockData';

export default function ControlPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [signalsMap, setSignalsMap] = useState<Record<string, ApiSignal[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Partial<Strategy>>>({});

  async function loadStrategies() {
    try {
      const data = await getStrategies();
      setStrategies(data);
      const initEditing: Record<string, Partial<Strategy>> = {};
      for (const s of data) {
        initEditing[s.id] = {
          maxPositionSize: s.maxPositionSize,
          maxDailyLoss: s.maxDailyLoss,
          maxExposure: s.maxExposure,
          config: s.config,
        };
      }
      setEditing(initEditing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load strategies');
      setStrategies(mockStrategies);
    } finally {
      setLoading(false);
    }
  }

  async function loadSignals() {
    if (strategies.length === 0) return;
    const map: Record<string, ApiSignal[]> = {};
    await Promise.all(
      strategies.map(async (s) => {
        try {
          const signals = await getStrategySignals(s.id);
          map[s.id] = signals;
        } catch {
          map[s.id] = [];
        }
      })
    );
    setSignalsMap(map);
  }

  useEffect(() => {
    loadStrategies();
  }, []);

  useEffect(() => {
    loadSignals();
    const interval = setInterval(loadSignals, 30000);
    return () => clearInterval(interval);
  }, [strategies]);

  async function handleToggleStatus(strategy: Strategy) {
    const nextStatus = strategy.status === 'active' ? 'paused' : 'active';
    try {
      setSavingId(strategy.id);
      const updated = await updateStrategy(strategy.id, { status: nextStatus });
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingId(null);
    }
  }

  async function handleStop(strategy: Strategy) {
    try {
      setSavingId(strategy.id);
      const updated = await updateStrategy(strategy.id, { status: 'stopped' });
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingId(null);
    }
  }

  async function handleSave(strategy: Strategy) {
    const edits = editing[strategy.id];
    try {
      setSavingId(strategy.id);
      const updated = await updateStrategy(strategy.id, {
        maxPositionSize: edits?.maxPositionSize,
        maxDailyLoss: edits?.maxDailyLoss,
        maxExposure: edits?.maxExposure,
        config: edits?.config,
      });
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  }

  function updateEdit(id: string, patch: Partial<Strategy>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  const allSignals = Object.values(signalsMap).flat().sort(
    (a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Strategy Control</h1>
          <p className="text-sm text-text-secondary">Enable, disable, tune parameters, and view live signals</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-no/30 bg-no/10 px-4 py-3 text-sm text-no">
          API Error: {error}. Showing fallback data.
        </div>
      )}

      {/* Strategy Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {strategies.map((strategy) => {
          const isActive = strategy.status === 'active';
          const isStopped = strategy.status === 'stopped';
          const edits = editing[strategy.id] || {};
          const strategySignals = signalsMap[strategy.id] || [];
          const latestSignal = strategySignals[0];

          return (
            <Card key={strategy.id} className={cn(isStopped && 'opacity-60')}>
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
              <CardContent className="space-y-5">
                {/* Status Row */}
                <div className="flex items-center justify-between rounded-lg bg-surface p-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-full',
                        isActive ? 'bg-yes/20 text-yes' : 'bg-slate-600/30 text-text-secondary'
                      )}
                    >
                      <Activity className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {isActive ? 'Running' : isStopped ? 'Stopped' : 'Paused'}
                      </p>
                      <p className="text-xs text-text-secondary">{strategy.tradesToday} trades today</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={isActive}
                      onCheckedChange={() => handleToggleStatus(strategy)}
                      disabled={savingId === strategy.id || isStopped}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStop(strategy)}
                      disabled={savingId === strategy.id || isStopped}
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Latest Signal */}
                {latestSignal && (
                  <div className="rounded-lg border border-accent/30 bg-accent/10 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-accent">
                      <Radio className="h-3.5 w-3.5" />
                      Latest Signal
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-text-primary">
                        <span className={cn('font-semibold', latestSignal.side === 'yes' ? 'text-yes' : 'text-no')}>
                          {latestSignal.side.toUpperCase()}
                        </span>{' '}
                        @ {latestSignal.current_price}¢
                      </div>
                      <div className="text-xs text-text-secondary">
                        {Math.round(latestSignal.confidence * 100)}% confidence
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">{latestSignal.reason}</p>
                  </div>
                )}

                {/* Config Form */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Settings2 className="h-4 w-4" />
                    Configuration
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-text-secondary">Max Position ($)</label>
                      <Input
                        type="number"
                        value={edits.maxPositionSize ?? ''}
                        onChange={(e) => updateEdit(strategy.id, { maxPositionSize: Number(e.target.value) })}
                        placeholder="e.g. 500"
                        disabled={savingId === strategy.id}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-text-secondary">Max Daily Loss ($)</label>
                      <Input
                        type="number"
                        value={edits.maxDailyLoss ?? ''}
                        onChange={(e) => updateEdit(strategy.id, { maxDailyLoss: Number(e.target.value) })}
                        placeholder="e.g. 200"
                        disabled={savingId === strategy.id}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-text-secondary">Max Exposure ($)</label>
                    <Input
                      type="number"
                      value={edits.maxExposure ?? ''}
                      onChange={(e) => updateEdit(strategy.id, { maxExposure: Number(e.target.value) })}
                      placeholder="e.g. 2000"
                      disabled={savingId === strategy.id}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-text-secondary">Strategy Config (JSON)</label>
                    <textarea
                      className={cn(
                        'flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50'
                      )}
                      value={edits.config ? JSON.stringify(edits.config, null, 2) : ''}
                      onChange={(e) => {
                        try {
                          const parsed = e.target.value ? JSON.parse(e.target.value) : undefined;
                          updateEdit(strategy.id, { config: parsed });
                        } catch {
                          // allow invalid JSON while typing
                        }
                      }}
                      placeholder='{"lookback": 20, "threshold": 0.05}'
                      disabled={savingId === strategy.id}
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <Clock className="h-3.5 w-3.5" />
                    Updated {strategy.updatedAt ? new Date(strategy.updatedAt).toLocaleString() : '—'}
                  </div>
                  <Button size="sm" onClick={() => handleSave(strategy)} disabled={savingId === strategy.id}>
                    {savingId === strategy.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Live Signal Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-accent" />
            Live Signal Feed
          </CardTitle>
          <CardDescription>Auto-refreshes every 30 seconds</CardDescription>
        </CardHeader>
        <CardContent>
          {allSignals.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-lg bg-surface text-sm text-text-secondary">
              No signals generated yet
            </div>
          ) : (
            <div className="space-y-3">
              {allSignals.slice(0, 20).map((sig) => (
                <div
                  key={sig.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={sig.side === 'yes' ? 'yes' : 'no'}>{sig.side.toUpperCase()}</Badge>
                      <span className="font-medium text-text-primary">{sig.signal_type}</span>
                      <span className="text-xs text-text-secondary">
                        {new Date(sig.generated_at).toLocaleString()}
                      </span>
                      {sig.acted_on ? (
                        <Badge variant="secondary">Acted</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">{sig.reason}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">Price</p>
                      <p className="font-medium text-text-primary">{sig.current_price}¢</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">Target</p>
                      <p className="font-medium text-text-primary">{sig.target_price}¢</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">Confidence</p>
                      <p className="font-medium text-text-primary">{Math.round(sig.confidence * 100)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">Contracts</p>
                      <p className="font-medium text-text-primary">{sig.recommended_contracts}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-text-secondary">Edge</p>
                      <p className="font-medium text-yes">+{sig.expected_edge}¢</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
