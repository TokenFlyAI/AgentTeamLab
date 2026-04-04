# Kalshi Trading Dashboard — UI Design Document

## Overview
A real-time trading dashboard for Kalshi prediction markets. Clean, data-dense, professional — think Bloomberg Terminal meets modern web UI.

## Core Views

### 1. Market Explorer
- **Purpose**: Browse and filter available markets
- **Key Elements**:
  - Category tabs (Economics, Politics, Crypto, Weather, Sports)
  - Search bar with real-time filtering
  - Market cards: Event title, current price (YES/NO), volume, time remaining
  - Sort options: Volume, Closing soon, Price movement

### 2. Market Detail
- **Purpose**: Deep dive into a specific market
- **Key Elements**:
  - Price chart (historical trades)
  - Order book visualization
  - Your position (if any)
  - Trade entry form (buy/sell, contracts, limit/market)
  - Market info: Description, rules, expiration, settlement criteria

### 3. Portfolio
- **Purpose**: Track open positions and P&L
- **Key Elements**:
  - Open positions table: Market, side (YES/NO), entry price, current price, P&L
  - Closed positions (history)
  - Account balance and available buying power
  - Daily/weekly/monthly P&L summary

### 4. Strategy Monitor
- **Purpose**: View automated strategy performance
- **Key Elements**:
  - Active strategies list with status
  - Signal strength indicators
  - Strategy P&L breakdown
  - Enable/disable controls

## Design Tokens

### Colors
- Background: `#0f172a` (slate-900)
- Surface: `#1e293b` (slate-800)
- Border: `#334155` (slate-700)
- Text Primary: `#f8fafc` (slate-50)
- Text Secondary: `#94a3b8` (slate-400)
- YES/Green: `#22c55e` (green-500)
- NO/Red: `#ef4444` (red-500)
- Accent: `#3b82f6` (blue-500)

### Typography
- Font: Inter or system-ui
- Sizes: xs (12px), sm (14px), base (16px), lg (18px), xl (24px), 2xl (32px)

### Spacing
- Dense layout: 4px, 8px, 12px, 16px, 24px
- Max content width: 1400px

## Component Architecture

```
app/
├── layout.tsx              # Root layout with navigation
├── page.tsx                # Dashboard home / Market Explorer
├── market/
│   └── [id]/
│       └── page.tsx        # Market detail view
├── portfolio/
│   └── page.tsx            # Portfolio view
├── strategies/
│   └── page.tsx            # Strategy monitor
└── components/
    ├── ui/                 # Primitive components
    │   ├── Button.tsx
    │   ├── Card.tsx
    │   ├── Input.tsx
    │   ├── Badge.tsx
    │   └── PriceDisplay.tsx
    ├── market/
    │   ├── MarketCard.tsx
    │   ├── MarketList.tsx
    │   ├── PriceChart.tsx
    │   └── OrderBook.tsx
    ├── portfolio/
    │   ├── PositionRow.tsx
    │   ├── PositionTable.tsx
    │   └── PnLSummary.tsx
    └── layout/
        ├── Sidebar.tsx
        ├── Header.tsx
        └── NavItem.tsx
```

## State Management
- **Server State**: React Query for API data (markets, prices, positions)
- **Client State**: Zustand for UI state (selected filters, sidebar open/closed)
- **Real-time**: WebSocket or polling for price updates

## Responsive Breakpoints
- Mobile: < 640px (single column, bottom nav)
- Tablet: 640px - 1024px (condensed sidebar)
- Desktop: > 1024px (full layout)

## Accessibility
- All interactive elements keyboard accessible
- ARIA labels for price changes (live regions)
- Color not sole indicator (icons + text for YES/NO)
- Focus visible states

## Loading States
- Skeleton screens for market cards
- Spinner for trade submission
- Progressive loading for charts

## Error States
- API error: Toast notification + retry button
- Empty portfolio: Helpful illustration + CTA to explore markets
- Market closed: Clear badge + settlement info
