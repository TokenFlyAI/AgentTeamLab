# Sprint 8: Mobile Readiness Report — D004 Dashboard

**Author:** Judy (Mobile Engineer)
**Date:** 2026-04-07
**Task ID:** T948
**Status:** COMPLETE

## 1. Evaluation of Current D004 Dashboard (Web)

The current dashboard implementation by Charlie (`output/charlie/my-app`) is a robust Next.js application using TailwindCSS. While it has basic responsiveness, it is primarily optimized for desktop/tablet viewports.

### Findings:
*   **Sidebar Navigation:** The fixed `w-16` sidebar on mobile (approx. 64px) consumes significant horizontal real estate (~17% on an iPhone SE). This pushes the main content into a narrow column, making charts and data tables difficult to read.
*   **Grid Density:** The `StrategiesPage` and `MarketList` use `grid-cols-1` on small screens. While functional, the cards are vertically tall and require excessive scrolling. Aggregate stats cards (Realized P&L, etc.) stack 4-deep, pushing the main performance chart below the first fold.
*   **Market Detail Layout:** The trade form and position summary are located at the bottom of the page. On mobile, this requires scrolling past the chart and order book, which is inefficient for active traders.
*   **Interactions:** Hover-based tooltips and interactions do not translate well to touch. The UI lacks gesture-based navigation (e.g., swipe to change tabs).

## 2. Recommendations for Mobile-First Arbitrage Monitoring

To transform the D004 dashboard into a "Mobile-First" experience, I recommend the following architectural and UI changes:

### A. Navigation & Shell
*   **Bottom Navigation Bar (PWA):** On screen widths < 640px, hide the Sidebar and Header-menu. Implement a fixed Bottom Navigation Bar with 4-5 core icons (Home, Portfolio, Signals, Settings).
*   **PWA Transformation:** Add a `manifest.json` and Service Worker to Charlie's Next.js app. This allows users to "Install" the app on their home screen and enables native-like Push Notification support on iOS and Android.

### B. UI Component Optimization
*   **Stats Carousel:** Instead of stacking summary cards, use a horizontal swipeable carousel for the top stats (Daily P&L, Total Trades, Sharpe, etc.).
*   **Collapsible Cards:** For Strategy cards, show only name, status, and Win Rate by default. Allow tapping to expand details like Sharpe and Max Drawdown.
*   **Sticky Trade CTA:** In `MarketDetailClient`, add a sticky "Buy YES / Buy NO" button at the bottom of the viewport. Tapping it opens a **Bottom Sheet** (Drawer) with the trade form, keeping the price chart visible in the background.

### C. Arbitrage-Focused Feed
*   **Signal Priority:** The mobile home screen should default to an "Active Signals" feed derived from `correlation_pairs.json`, rather than a general market list.
*   **Visual Confidence:** Use color-coded progress rings for Arbitrage Confidence (Green >= 90%, Yellow 80-89%, Red < 80%).

## 3. Push Notification Strategy

Push notifications are critical for arbitrageurs who cannot monitor a screen 24/7. 

### Trigger Proposals:
| Trigger Event | Threshold / Logic | Notification Payload Example |
| :--- | :--- | :--- |
| **New Arbitrage Opportunity** | `confidence >= 0.90` | "🚨 New Arbitrage: BTC/ETH (96% Confidence). Direction: Buy YES / Sell NO." |
| **Significant Spread Widening** | `spread_deviation > 2.5σ` | "⚠️ Spread Anomaly: S&P 500 / Nasdaq spread widened to 2.8σ. High volatility." |
| **Trade Execution** | Phase 4 Trade Success | "✅ Trade Executed: 10 contracts BTC/ETH. Estimated Profit: +$4.50." |
| **Risk Circuit Breaker** | Daily Loss Limit hit | "🛑 TRADING HALTED: Daily loss limit (-$500) reached. All strategies paused." |
| **Data Quality Alert** | Grace/Ivan audit failure | "⚠️ Strategy Paused: 'Mean Reversion' halted due to stale Phase 3 data." |

### Notification Payload Schema (FCM/APNs):
```json
{
  "title": "Arbitrage Alert",
  "body": "BTC vs ETH: 96% Confidence",
  "data": {
    "type": "NEW_SIGNAL",
    "pair_id": "btc_eth_2026",
    "confidence": "0.96",
    "deep_link": "kalshi-trader://opportunity/btc_eth_2026"
  }
}
```

## 4. Next Steps for Mobile Implementation

1.  **SwiftUI/Compose Prototypes:** I will continue developing the native companion app prototypes for high-performance monitoring.
2.  **PWA Integration:** Coordinate with Charlie to add `next-pwa` to the dashboard to enable push notifications on the web client.
3.  **Push API:** Work with Bob to ensure the backend can trigger FCM/APNs requests whenever `trade_signals.json` is updated with high-confidence pairs.
