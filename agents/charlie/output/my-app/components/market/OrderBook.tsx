'use client';

import { cn } from '@/lib/utils';

interface OrderLevel {
  price: number;
  size: number;
  total: number;
}

interface OrderBookProps {
  yesOrders: OrderLevel[];
  noOrders: OrderLevel[];
}

export function OrderBook({ yesOrders, noOrders }: OrderBookProps) {
  const maxTotal = Math.max(
    ...yesOrders.map((o) => o.total),
    ...noOrders.map((o) => o.total)
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* YES Orders */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-yes">YES Orders</h4>
        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-2 text-xs text-text-secondary">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {yesOrders.map((order, i) => (
            <div
              key={i}
              className="relative grid grid-cols-3 gap-2 rounded py-1 text-sm"
            >
              <div
                className="absolute inset-0 rounded bg-yes/10"
                style={{ width: `${(order.total / maxTotal) * 100}%` }}
              />
              <span className="relative text-yes">${order.price.toFixed(2)}</span>
              <span className="relative text-right text-text-primary">{order.size}</span>
              <span className="relative text-right text-text-secondary">{order.total}</span>
            </div>
          ))}
        </div>
      </div>

      {/* NO Orders */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-no">NO Orders</h4>
        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-2 text-xs text-text-secondary">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {noOrders.map((order, i) => (
            <div
              key={i}
              className="relative grid grid-cols-3 gap-2 rounded py-1 text-sm"
            >
              <div
                className="absolute inset-0 rounded bg-no/10"
                style={{ width: `${(order.total / maxTotal) * 100}%` }}
              />
              <span className="relative text-no">${order.price.toFixed(2)}</span>
              <span className="relative text-right text-text-primary">{order.size}</span>
              <span className="relative text-right text-text-secondary">{order.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
