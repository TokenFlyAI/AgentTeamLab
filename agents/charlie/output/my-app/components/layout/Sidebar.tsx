'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, BarChart3, Wallet, Settings, Zap, PieChart, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Markets', icon: TrendingUp },
  { href: '/portfolio', label: 'Portfolio', icon: Wallet },
  { href: '/strategies', label: 'Strategies', icon: Zap },
  { href: '/pnl', label: 'P&L', icon: PieChart },
  { href: '/control', label: 'Control', icon: SlidersHorizontal },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-16 border-r border-border bg-surface lg:w-64">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-center border-b border-border lg:justify-start lg:px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <span className="ml-3 hidden text-lg font-bold text-text-primary lg:block">
            KalshiTrader
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center rounded-lg px-3 py-2.5 transition-colors',
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="ml-3 hidden font-medium lg:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Account Summary */}
        <div className="border-t border-border p-4">
          <div className="hidden lg:block">
            <p className="text-xs text-text-secondary">Available Balance</p>
            <p className="text-lg font-semibold text-text-primary">$3,250.00</p>
          </div>
          <div className="flex justify-center lg:hidden">
            <div className="h-8 w-8 rounded-full bg-accent/20" />
          </div>
        </div>
      </div>
    </aside>
  );
}
