'use client';

import { Market } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { formatNumber, formatDate } from '@/lib/utils';
import { Clock, TrendingUp } from 'lucide-react';
import Link from 'next/link';

interface MarketCardProps {
  market: Market;
}

export function MarketCard({ market }: MarketCardProps) {
  return (
    <Link href={`/market/${market.id}`}>
      <Card className="h-full cursor-pointer transition-all hover:border-accent/50 hover:shadow-lg">
        <CardContent className="p-4">
          {/* Header */}
          <div className="mb-3 flex items-start justify-between">
            <Badge variant="secondary" className="text-xs">
              {market.category}
            </Badge>
            {market.status === 'open' ? (
              <div className="flex items-center gap-1 text-xs text-text-secondary">
                <Clock className="h-3 w-3" />
                <span>{formatDate(market.expirationDate)}</span>
              </div>
            ) : (
              <Badge variant="outline">Closed</Badge>
            )}
          </div>

          {/* Title */}
          <h3 className="mb-4 line-clamp-2 text-sm font-medium text-text-primary">
            {market.title}
          </h3>

          {/* Prices */}
          <div className="mb-3 flex items-center justify-between">
            <PriceDisplay price={market.yesPrice} side="YES" size="md" />
            <PriceDisplay price={market.noPrice} side="NO" size="md" />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-text-secondary">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span>Vol: {formatNumber(market.volume)}</span>
            </div>
            <span>24h: {formatNumber(market.volume24h)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
