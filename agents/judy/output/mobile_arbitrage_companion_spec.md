# Mobile Arbitrage Companion — Design Spec

## Overview
A lightweight mobile companion app for D004 arbitrage monitoring. Not a full trading terminal — instead, a focused alert-and-monitor experience that surfaces high-confidence arbitrage opportunities and tracks execution status.

**Platform scope:** iOS (SwiftUI) primary, Android (Jetpack Compose) secondary, shared design language.

## Mobile-First Constraints
- **Battery:** Background refresh limited to 15-min intervals + silent push triggers
- **Bandwidth:** Correlation pairs JSON (~3KB) cached locally; images/charts avoided
- **Touch:** All actions reachable within thumb zone; swipe gestures for dismissal
- **Offline:** Last-known opportunities visible even without network

## Core Screens

### 1. Opportunity Feed (Home)
- **Purpose:** Surface active arbitrage opportunities from `correlation_pairs.json`
- **Layout:** Vertical list of cards, one per opportunity
- **Card contents:**
  - Cluster badge (Crypto, Finance, etc.)
  - Market pair: `market_a` ↔ `market_b`
  - Confidence score as progress bar (color-coded: ≥0.95 green, 0.85-0.94 yellow, <0.85 gray)
  - Direction pill: "Buy A / Sell B" or "Sell A / Buy B"
  - Spread deviation: `+2.08σ` style
  - Timestamp of last update
- **Interactions:**
  - Tap card → Detail view
  - Swipe left → Dismiss / "Not interested"
  - Pull-to-refresh → Fetch latest pairs

### 2. Opportunity Detail
- **Purpose:** Deep dive into a single pair
- **Layout:** Scrollable vertical stack
- **Sections:**
  - **Header:** Market names, cluster, confidence ring
  - **Stats grid (2-col):**
    - Pearson r
    - Expected spread
    - Current spread
    - Spread deviation (σ)
  - **Direction block:** Large pill showing buy/sell direction with market names spelled out
  - **Correlation note:** "These markets move together 95% of the time. The current spread is 2.08 standard deviations from normal."
  - **Action bar (fixed bottom):**
    - Primary: "View on Dashboard" (deep link to web)
    - Secondary: "Copy Pair Name"

### 3. Alert History
- **Purpose:** Track push notifications received
- **Layout:** Grouped by date, newest first
- **Item:** Alert title, confidence, timestamp, tapped/opened status
- **Empty state:** "No alerts yet. High-confidence opportunities will appear here."

### 4. Settings
- **Purpose:** Control notification preferences and data refresh
- **Options:**
  - Confidence threshold slider (default 0.85)
  - Cluster filters toggle list
  - Quiet hours (22:00–07:00 default)
  - Daily alert cap (default 20)
  - Clear cached data

## Design Tokens (Aligned with Charlie)
- Background: `#0f172a`
- Surface: `#1e293b`
- Border: `#334155`
- Text Primary: `#f8fafc`
- Text Secondary: `#94a3b8`
- Positive/Green: `#22c55e`
- Negative/Red: `#ef4444`
- Accent: `#3b82f6`

## Data Architecture
```
Local cache (Core Data / Room):
├── CachedOpportunity (from correlation_pairs.json)
├── AlertRecord (push notification history)
└── UserPreferences (thresholds, filters, quiet hours)

API integration:
├── GET /api/correlation-pairs (poll every 60s when foreground)
├── GET /api/signals (for push trigger validation)
└── POST /api/devices/register (APNs/FCM token)
```

## Push Notification Payload
```json
{
  "aps": {
    "alert": {
      "title": "Arbitrage: BTC vs ETH",
      "body": "Confidence 96% — Sell BTC / Buy ETH"
    },
    "badge": 1,
    "sound": "default"
  },
  "pair_id": "BTCW-26-JUN-100K|ETHW-26-DEC-5K",
  "confidence": 0.96,
  "direction": "sell_A_buy_B",
  "cluster": "crypto_cluster"
}
```

## Performance Targets
- Cold start: <1.5s on iPhone 12 / Pixel 5
- List scroll: 60fps with 20+ opportunity cards
- Background fetch: <5s wall-clock time
- App size target: <15MB

## Offline Behavior
- Feed shows last cached opportunities with stale timestamp badge
- Pull-to-refresh shows "offline" snackbar if no connectivity
- Push notifications queue locally if device is offline at receive time

## Platform-Specific Notes

### iOS (SwiftUI)
- Use `List` with `.swipeActions` for dismiss
- Request notification permission after user views 3rd opportunity (earn-before-ask)
- Widget support: small widget showing top opportunity confidence

### Android (Jetpack Compose)
- Use `LazyColumn` with `Dismissible` items
- Notification channels: "Arbitrage Opportunities" (high importance)
- Support for edge-to-edge and dynamic theming avoided — stick to fixed dark palette

## Deep Linking
- URL scheme: `kalshi-companion://opportunity/{pair_id}`
- Push tap routes directly to Opportunity Detail
- Web dashboard link uses universal link: `https://dashboard.agentplanet.io/opportunity/{pair_id}`

## Next Steps
1. Build SwiftUI prototype for Opportunity Feed + Detail
2. Implement local caching layer with Core Data
3. Integrate push notification registration with backend
4. Coordinate with Charlie on shared color tokens and iconography
