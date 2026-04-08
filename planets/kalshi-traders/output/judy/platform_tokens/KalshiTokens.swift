// KalshiTokens.swift
// Kalshi Alpha — Shared Design Tokens (iOS / SwiftUI)
// Synced from: agents/charlie/output/design_tokens.css
// Agent: judy | Generated: 2026-04-07
//
// Usage: Color.Token.bg, Color.Token.accent, etc.
// Requires: add ios_colorsets/ contents to Xcode Assets.xcassets

import SwiftUI

extension Color {
    enum Token {
        // MARK: Backgrounds
        static let bg        = Color("ColorBg")       // #0f172a slate-900
        static let surface   = Color("ColorSurface")  // #1e293b slate-800
        static let surface2  = Color("ColorSurface2") // #0d1117 outer chrome
        static let border    = Color("ColorBorder")   // #334155 slate-700

        // MARK: Text
        static let textPrimary   = Color("ColorTextPrimary")   // #f8fafc slate-50
        static let textSecondary = Color("ColorTextSecondary") // #94a3b8 slate-400
        static let textDim       = Color("ColorTextDim")       // #64748b slate-500

        // MARK: Signal / Status
        static let positive = Color("ColorPositive") // #22c55e green-500
        static let negative = Color("ColorNegative") // #ef4444 red-500
        static let warning  = Color("ColorWarning")  // #f59e0b amber-500
        static let accent   = Color("ColorAccent")   // #3b82f6 blue-500
        static let purple   = Color("ColorPurple")   // #8b5cf6 violet-500

        // MARK: Confidence threshold helpers (matches Phase 3 arbitrage_confidence)
        static func confidence(_ score: Double) -> Color {
            switch score {
            case 0.90...: return .Token.positive  // ≥ 0.90
            case 0.75..<0.90: return .Token.warning  // 0.75–0.89
            default: return .Token.negative          // < 0.75
            }
        }
    }
}

// MARK: Spacing scale (matches CSS --space-* vars)
enum TokenSpacing {
    static let s1: CGFloat = 4
    static let s2: CGFloat = 8
    static let s3: CGFloat = 12
    static let s4: CGFloat = 16
    static let s6: CGFloat = 24
    static let s8: CGFloat = 32
}

// MARK: Corner radius scale (matches CSS --radius-* vars)
enum TokenRadius {
    static let sm: CGFloat = 4
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
}
