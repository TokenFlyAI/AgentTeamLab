'use client';

import { useParams } from 'next/navigation';
import { mockMarkets, mockPriceHistory, mockPositions } from '@/lib/mockData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { PriceChart } from '@/components/market/PriceChart';
import { OrderBook } from '@/components/market/OrderBook';
import { PriceDisplay, PnLDisplay } from '@/components/ui/PriceDisplay';
import { formatNumber, formatDate } from '@/lib/utils';
import { ArrowLeft, Clock, TrendingUp, Info } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

// Mock order book data
const mockYesOrders = [
  { price: 0.36, size: 500, total: 500 },
  { price: 0.37, size: 300, total: 800 },
  { price: 0.38, size: 450, total: 1250 },
  { price: 0.39, size: 200, total: 1450 },
];

const mockNoOrders = [
  { price: 0.63, size: 400, total: 400 },
  { price: 0.62, size: 350, total: 750 },
  { price: 0.61, size: 500, total: 1250 },
  { price: 0.60, size: 250, total: 1500 },
];

export default function MarketDetailClient() {
  const params = useParams();
  const marketId = params.id as string;
  const market = mockMarkets.find((m) => m.id === marketId);
  const position = mockPositions.find((p) => p.marketId === marketId);
  
  const [tradeSide, setTradeSide] = useState<'YES' | 'NO'>('YES');
  const [contracts, setContracts] = useState(10);

  if (!market) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-text-secondary">Market not found</p>
        <Link href="/" className="mt-4 text-accent hover:underline">
          Back to markets
        </Link>
      </div>
    );
  }

  const totalCost = contracts * (tradeSide === 'YES' ? market.yesPrice : market.noPrice);

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to markets
      </Link>

      {/* Market Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">{market.category}</Badge>
            {market.status === 'open' ? (
              <Badge variant="yes">Open</Badge>
            ) : (
              <Badge variant="outline">Closed</Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold text-text-primary">{market.title}</h1>
          <div className="mt-2 flex items-center gap-4 text-sm text-text-secondary">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Expires in {formatDate(market.expirationDate)}
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" />
              Vol: {formatNumber(market.volume)}
            </span>
          </div>
        </div>

        {/* Current Prices */}
        <div className="flex gap-4">
          <div className="rounded-lg bg-surface p-4">
            <PriceDisplay price={market.yesPrice} side="YES" size="lg" />
          </div>
          <div className="rounded-lg bg-surface p-4">
            <PriceDisplay price={market.noPrice} side="NO" size="lg" />
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Chart & Info */}
        <div className="space-y-6 lg:col-span-2">
          {/* Price Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Price History</CardTitle>
            </CardHeader>
            <CardContent>
              <PriceChart data={mockPriceHistory} side="YES" />
            </CardContent>
          </Card>

          {/* Order Book */}
          <Card>
            <CardHeader>
              <CardTitle>Order Book</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderBook yesOrders={mockYesOrders} noOrders={mockNoOrders} />
            </CardContent>
          </Card>

          {/* Market Info */}
          {market.description && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Market Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="mb-1 text-sm font-medium text-text-primary">Description</h4>
                  <p className="text-sm text-text-secondary">{market.description}</p>
                </div>
                {market.settlementCriteria && (
                  <div>
                    <h4 className="mb-1 text-sm font-medium text-text-primary">Settlement Criteria</h4>
                    <p className="text-sm text-text-secondary">{market.settlementCriteria}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Trade & Position */}
        <div className="space-y-6">
          {/* Trade Form */}
          <Card>
            <CardHeader>
              <CardTitle>Trade</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Side Selection */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTradeSide('YES')}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                    tradeSide === 'YES'
                      ? 'bg-yes text-white'
                      : 'bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Buy YES
                </button>
                <button
                  onClick={() => setTradeSide('NO')}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                    tradeSide === 'NO'
                      ? 'bg-no text-white'
                      : 'bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Buy NO
                </button>
              </div>

              {/* Contracts Input */}
              <div>
                <label className="mb-1 block text-sm text-text-secondary">
                  Contracts
                </label>
                <Input
                  type="number"
                  min={1}
                  value={contracts}
                  onChange={(e) => setContracts(parseInt(e.target.value) || 0)}
                />
              </div>

              {/* Price Info */}
              <div className="space-y-2 rounded-lg bg-surface p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Price</span>
                  <span className="text-text-primary">
                    ${(tradeSide === 'YES' ? market.yesPrice : market.noPrice).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Total Cost</span>
                  <span className="font-medium text-text-primary">
                    ${totalCost.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Potential Profit</span>
                  <span className="text-yes">
                    +${(contracts - totalCost).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                variant={tradeSide === 'YES' ? 'yes' : 'no'}
                className="w-full"
                size="lg"
              >
                Buy {tradeSide}
              </Button>
            </CardContent>
          </Card>

          {/* Your Position */}
          {position ? (
            <Card>
              <CardHeader>
                <CardTitle>Your Position</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Side</span>
                  <span className={position.side === 'YES' ? 'text-yes' : 'text-no'}>
                    {position.side}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Contracts</span>
                  <span className="text-text-primary">{position.contracts}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Entry Price</span>
                  <span className="text-text-primary">
                    ${position.entryPrice.toFixed(2)}
                  </span>
                </div>
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">P&L</span>
                    <PnLDisplay value={position.pnl} percent={position.pnlPercent} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-sm text-text-secondary">No position in this market</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
