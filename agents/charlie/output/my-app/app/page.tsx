'use client';

import { useState } from 'react';
import { MarketList, MarketSortTabs } from '@/components/market/MarketList';
import { mockMarkets } from '@/lib/mockData';
import { Input } from '@/components/ui/Input';
import { Search } from 'lucide-react';

type Category = 'all' | 'economics' | 'politics' | 'crypto' | 'weather' | 'sports';
type SortOption = 'volume' | 'closing' | 'movement';

const categories: { value: Category; label: string }[] = [
  { value: 'all', label: 'All Markets' },
  { value: 'economics', label: 'Economics' },
  { value: 'politics', label: 'Politics' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'weather', label: 'Weather' },
  { value: 'sports', label: 'Sports' },
];

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<Category>('all');
  const [sortBy, setSortBy] = useState<SortOption>('volume');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMarkets = mockMarkets.filter((market) => {
    const matchesCategory = activeCategory === 'all' || market.category === activeCategory;
    const matchesSearch = market.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Market Explorer</h1>
          <p className="text-sm text-text-secondary">
            Browse and trade prediction markets
          </p>
        </div>
        
        {/* Search (mobile only) */}
        <div className="relative sm:hidden">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            type="search"
            placeholder="Search markets..."
            className="w-full pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeCategory === cat.value
                ? 'bg-accent text-white'
                : 'bg-surface text-text-secondary hover:text-text-primary'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Sort Options */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {filteredMarkets.length} markets
        </p>
        <MarketSortTabs value={sortBy} onChange={setSortBy} />
      </div>

      {/* Market Grid */}
      <MarketList markets={filteredMarkets} sortBy={sortBy} />
    </div>
  );
}
