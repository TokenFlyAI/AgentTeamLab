export interface Market {
  id: string;
  title: string;
  category: 'economics' | 'politics' | 'crypto' | 'weather' | 'sports';
  yesPrice: number;
  noPrice: number;
  volume: number;
  volume24h: number;
  expirationDate: string;
  status: 'open' | 'closed' | 'settled';
  description?: string;
  rules?: string;
  settlementCriteria?: string;
}

export interface Position {
  id: string;
  marketId: string;
  marketTitle: string;
  side: 'YES' | 'NO';
  contracts: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface Trade {
  id: string;
  marketId: string;
  side: 'YES' | 'NO';
  type: 'buy' | 'sell';
  contracts: number;
  price: number;
  total: number;
  timestamp: string;
  status: 'pending' | 'filled' | 'cancelled';
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'stopped';
  signalStrength: number;
  totalPnl: number;
  tradesToday: number;
  winRate: number;
  strategyType?: string;
  config?: Record<string, unknown>;
  maxPositionSize?: number;
  maxDailyLoss?: number;
  maxExposure?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PnLReport {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalRealizedPnl: number; // in cents
  totalUnrealizedPnl: number; // in cents
  sharpeRatio: number;
  maxDrawdown: number; // in cents
  dailyReturns: number[]; // in cents
}

export interface Account {
  balance: number;
  availableBuyingPower: number;
  totalPnl: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
}

export interface PricePoint {
  timestamp: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
}
