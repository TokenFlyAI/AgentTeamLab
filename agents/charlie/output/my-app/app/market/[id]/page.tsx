import MarketDetailClient from './MarketDetailClient';

// Required for static export with dynamic routes
export function generateStaticParams() {
  return [
    { id: 'market-1' },
    { id: 'market-2' },
    { id: 'market-3' },
    { id: 'market-4' },
    { id: 'market-5' },
    { id: 'market-6' },
  ];
}

export default function MarketDetailPage() {
  return <MarketDetailClient />;
}
