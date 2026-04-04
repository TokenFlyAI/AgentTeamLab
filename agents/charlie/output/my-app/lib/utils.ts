import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 0) {
    return 'Expired';
  }
  if (diffDays === 1) {
    return '1 day';
  }
  if (diffDays < 30) {
    return `${diffDays} days`;
  }
  if (diffDays < 365) {
    return `${Math.floor(diffDays / 30)} months`;
  }
  return `${Math.floor(diffDays / 365)} years`;
}

export function getPnlColor(pnl: number): string {
  return pnl >= 0 ? 'text-yes' : 'text-no';
}
