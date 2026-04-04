'use client';

import { Position } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { PnLDisplay } from '@/components/ui/PriceDisplay';
import { formatPrice } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PositionTableProps {
  positions: Position[];
}

export function PositionTable({ positions }: PositionTableProps) {
  if (positions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Minus className="mb-4 h-12 w-12 text-text-secondary" />
          <p className="text-text-secondary">No open positions</p>
          <p className="text-sm text-text-secondary">Start trading to build your portfolio</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-secondary">
                <th className="pb-3 font-medium">Market</th>
                <th className="pb-3 font-medium">Side</th>
                <th className="pb-3 font-medium text-right">Contracts</th>
                <th className="pb-3 font-medium text-right">Entry</th>
                <th className="pb-3 font-medium text-right">Current</th>
                <th className="pb-3 font-medium text-right">P&L</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {positions.map((position) => (
                <tr
                  key={position.id}
                  className="border-b border-border/50 last:border-0 hover:bg-surface/50"
                >
                  <td className="py-4">
                    <div className="max-w-[200px] truncate font-medium text-text-primary">
                      {position.marketTitle}
                    </div>
                  </td>
                  <td className="py-4">
                    <span
                      className={
                        position.side === 'YES' ? 'text-yes' : 'text-no'
                      }
                    >
                      {position.side}
                    </span>
                  </td>
                  <td className="py-4 text-right text-text-primary">
                    {position.contracts}
                  </td>
                  <td className="py-4 text-right text-text-primary">
                    {formatPrice(position.entryPrice)}
                  </td>
                  <td className="py-4 text-right text-text-primary">
                    {formatPrice(position.currentPrice)}
                  </td>
                  <td className="py-4 text-right">
                    <PnLDisplay value={position.pnl} percent={position.pnlPercent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
