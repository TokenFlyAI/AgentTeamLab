// Models.swift
// Kalshi Alpha — Shared data models
// Synced with shared card shape (finalized with Charlie, 2026-04-07)
// GET /api/pipeline/pairs response shape

import Foundation

// MARK: - Opportunity (shared card shape)

struct Opportunity: Identifiable, Decodable, Equatable {
    // pair_id is the canonical identifier — composite key e.g. "BTCW-26-JUN-100K|ETHW-26-DEC-5K"
    let pairId: String
    let marketA: String
    let marketB: String
    let cluster: String
    let confidence: Double          // weighted_confidence from Phase 3
    let direction: TradeDirection
    let spreadZscore: Double        // spread_deviation in σ units
    let timestamp: Date

    var id: String { pairId }

    // Confidence tier — mirrors Color.Token.confidence() and JS confidenceColor()
    var confidenceTier: ConfidenceTier {
        switch confidence {
        case 0.90...: return .high
        case 0.75..<0.90: return .mid
        default: return .low
        }
    }

    enum CodingKeys: String, CodingKey {
        case pairId = "pair_id"
        case marketA = "market_a"
        case marketB = "market_b"
        case cluster
        case confidence
        case direction
        case spreadZscore = "spread_zscore"
        case timestamp
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pairId      = try c.decode(String.self, forKey: .pairId)
        marketA     = try c.decode(String.self, forKey: .marketA)
        marketB     = try c.decode(String.self, forKey: .marketB)
        cluster     = try c.decode(String.self, forKey: .cluster)
        confidence  = try c.decode(Double.self, forKey: .confidence)
        direction   = try c.decode(TradeDirection.self, forKey: .direction)
        spreadZscore = try c.decode(Double.self, forKey: .spreadZscore)
        let iso = try c.decode(String.self, forKey: .timestamp)
        timestamp   = ISO8601DateFormatter().date(from: iso) ?? Date()
    }
}

// MARK: - Trade Direction

enum TradeDirection: String, Decodable {
    case buyABsellB = "buy_A_sell_B"
    case sellABuyB  = "sell_A_buy_B"

    func label(marketA: String, marketB: String) -> String {
        switch self {
        case .buyABsellB:  return "Buy \(marketA) / Sell \(marketB)"
        case .sellABuyB:   return "Sell \(marketA) / Buy \(marketB)"
        }
    }

    var shortLabel: String {
        switch self {
        case .buyABsellB: return "Buy A / Sell B"
        case .sellABuyB:  return "Sell A / Buy B"
        }
    }
}

// MARK: - Confidence Tier

enum ConfidenceTier {
    case high   // ≥ 0.90 — green
    case mid    // 0.75 – 0.89 — amber
    case low    // < 0.75 — red
}

// MARK: - Pipeline Pairs Response

struct PipelinePairsResponse: Decodable {
    let pairs: [Opportunity]
    let generatedAt: Date

    enum CodingKeys: String, CodingKey {
        case pairs
        case generatedAt = "generated_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pairs = try c.decode([Opportunity].self, forKey: .pairs)
        let iso = try c.decode(String.self, forKey: .generatedAt)
        generatedAt = ISO8601DateFormatter().date(from: iso) ?? Date()
    }
}

// MARK: - Alert Record (local history)

struct AlertRecord: Identifiable, Codable {
    let id: UUID
    let pairId: String
    let title: String
    let confidence: Double
    let receivedAt: Date
    var wasOpened: Bool

    init(pairId: String, title: String, confidence: Double) {
        self.id = UUID()
        self.pairId = pairId
        self.title = title
        self.confidence = confidence
        self.receivedAt = Date()
        self.wasOpened = false
    }
}
