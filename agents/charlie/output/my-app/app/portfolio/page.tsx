import { PositionTable } from '@/components/portfolio/PositionTable';
import { PnLSummary } from '@/components/portfolio/PnLSummary';
import { mockPositions, mockAccount } from '@/lib/mockData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { History } from 'lucide-react';

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Portfolio</h1>
        <p className="text-sm text-text-secondary">
          Track your positions and performance
        </p>
      </div>

      {/* P&L Summary */}
      <PnLSummary account={mockAccount} />

      {/* Positions */}
      <PositionTable positions={mockPositions} />

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-surface p-4">
              <div>
                <p className="font-medium text-text-primary">Bought YES contracts</p>
                <p className="text-sm text-text-secondary">
                  Will Bitcoin exceed $100K by June 2026?
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-yes">+250 contracts</p>
                <p className="text-sm text-text-secondary">@ $0.45</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface p-4">
              <div>
                <p className="font-medium text-text-primary">Bought NO contracts</p>
                <p className="text-sm text-text-secondary">
                  Will US CPI exceed 3.5% in March 2026?
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-no">+100 contracts</p>
                <p className="text-sm text-text-secondary">@ $0.62</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
