'use client';

import { Market } from '@/types';
import { MarketCard } from './MarketCard';
import { TrendingUp, Clock, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

type SortOption = 'volume' | 'closing' | 'movement';

interface MarketListProps {
  markets: Market[];
  category?: string;
  sortBy?: SortOption;
}

const sortOptions: { value: SortOption; label: string; icon: typeof TrendingUp }[] = [
  { value: 'volume', label: 'Volume', icon: DollarSign },
  { value: 'closing', label: 'Closing Soon', icon: Clock },
  { value: 'movement', label: 'Price Movement', icon: TrendingUp },
];

export function MarketList({ markets, category, sortBy = 'volume' }: MarketListProps) {
  const filteredMarkets = category && category !== 'all'
    ? markets.filter((m) => m.category === category)
    : markets;

  const sortedMarkets = [...filteredMarkets].sort((a, b) => {
    switch (sortBy) {
      case 'volume':
        return b.volume - a.volume;
      case 'closing':
        return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
      case 'movement':
        return b.volume24h - a.volume24h;
      default:
        return 0;
    }
  });

  if (sortedMarkets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <TrendingUp className="mb-4 h-12 w-12 text-text-secondary" />
        <p className="text-text-secondary">No markets found</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {sortedMarkets.map((market) => (
        <MarketCard key={market.id} market={market} />
      ))}
    </div>
  );
}

export function MarketSortTabs({ 
  value, 
  onChange 
}: { 
  value: SortOption; 
  onChange: (value: SortOption) => void;
}) {
  return (
    <div className="flex gap-2">
      {sortOptions.map((option) => {
        const Icon = option.icon;
        const isActive = value === option.value;
        
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface'
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
