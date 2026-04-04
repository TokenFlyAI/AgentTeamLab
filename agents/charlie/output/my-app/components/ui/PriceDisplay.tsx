'use client';

import { cn } from '@/lib/utils';
import { formatPrice, formatPercent } from '@/lib/utils';

interface PriceDisplayProps {
  price: number;
  side: 'YES' | 'NO';
  change?: number;
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function PriceDisplay({
  price,
  side,
  change,
  showPercent = false,
  size = 'md',
}: PriceDisplayProps) {
  const isYes = side === 'YES';
  
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl font-bold',
  };

  return (
    <div className="flex flex-col items-end">
      <div className={cn('flex items-center gap-2', sizeClasses[size])}>
        <span
          className={cn(
            'font-medium',
            isYes ? 'text-yes' : 'text-no'
          )}
        >
          {side}
        </span>
        <span className="text-text-primary">{formatPrice(price)}</span>
      </div>
      {showPercent && change !== undefined && (
        <span
          className={cn(
            'text-xs',
            change >= 0 ? 'text-yes' : 'text-no'
          )}
        >
          {formatPercent(change)}
        </span>
      )}
    </div>
  );
}

interface PnLDisplayProps {
  value: number;
  percent?: number;
  size?: 'sm' | 'md' | 'lg';
}

export function PnLDisplay({ value, percent, size = 'md' }: PnLDisplayProps) {
  const isPositive = value >= 0;
  
  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg font-bold',
  };

  return (
    <div className={cn('flex flex-col items-end', sizeClasses[size])}>
      <span className={isPositive ? 'text-yes' : 'text-no'}>
        {isPositive ? '+' : ''}{value.toFixed(2)}
      </span>
      {percent !== undefined && (
        <span className={isPositive ? 'text-yes' : 'text-no'}>
          ({isPositive ? '+' : ''}{percent.toFixed(2)}%)
        </span>
      )}
    </div>
  );
}
