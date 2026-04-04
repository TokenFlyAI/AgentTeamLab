'use client';

import { Account } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { formatPrice, formatPercent } from '@/lib/utils';
import { TrendingUp, TrendingDown, Wallet, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PnLSummaryProps {
  account: Account;
}

interface StatCardProps {
  title: string;
  value: string;
  subValue?: string;
  icon: typeof TrendingUp;
  positive?: boolean;
}

function StatCard({ title, value, subValue, icon: Icon, positive }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-text-secondary">{title}</p>
            <p className={cn(
              'mt-1 text-2xl font-bold',
              positive === undefined ? 'text-text-primary' : positive ? 'text-yes' : 'text-no'
            )}>
              {value}
            </p>
            {subValue && (
              <p className="mt-0.5 text-xs text-text-secondary">{subValue}</p>
            )}
          </div>
          <div className="rounded-lg bg-surface p-2">
            <Icon className="h-5 w-5 text-text-secondary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PnLSummary({ account }: PnLSummaryProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Balance"
        value={formatPrice(account.balance)}
        subValue={`Available: ${formatPrice(account.availableBuyingPower)}`}
        icon={Wallet}
      />
      <StatCard
        title="Daily P&L"
        value={account.dailyPnl >= 0 ? `+${formatPrice(account.dailyPnl)}` : formatPrice(account.dailyPnl)}
        positive={account.dailyPnl >= 0}
        icon={TrendingUp}
      />
      <StatCard
        title="Weekly P&L"
        value={account.weeklyPnl >= 0 ? `+${formatPrice(account.weeklyPnl)}` : formatPrice(account.weeklyPnl)}
        positive={account.weeklyPnl >= 0}
        icon={Calendar}
      />
      <StatCard
        title="Total P&L"
        value={account.totalPnl >= 0 ? `+${formatPrice(account.totalPnl)}` : formatPrice(account.totalPnl)}
        positive={account.totalPnl >= 0}
        icon={account.totalPnl >= 0 ? TrendingUp : TrendingDown}
      />
    </div>
  );
}
