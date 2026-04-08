// PipelineClient.swift
// Kalshi Alpha — API client for /api/pipeline/pairs
// Base URL: http://localhost:3457 (serve_pipeline_dashboard.js — Charlie's pipeline dashboard)
// Port map: 3199=agent platform (server.js), 3457=pipeline dashboard, 3200=live Kalshi trading (post-T236)
// Auth: Bearer token via API_KEY env var (C2 compliance)
//
// NOTE: Blocked on T236 (Kalshi API credentials). Uses mock data until live.

import Foundation

@MainActor
final class PipelineClient: ObservableObject {

    // MARK: - Config

    static let shared = PipelineClient()

    private let baseURL: URL
    private let apiKey: String
    private let session: URLSession
    private var pollTask: Task<Void, Never>?

    // Poll interval: 60s foreground, background fetch via silent push
    static let pollIntervalSeconds: TimeInterval = 60

    // MARK: - Published state

    @Published var opportunities: [Opportunity] = []
    @Published var lastUpdated: Date?
    @Published var isLoading = false
    @Published var error: ClientError?

    // MARK: - Init

    private init() {
        // Port 3457 = serve_pipeline_dashboard.js (Charlie's pipeline dashboard)
        // Switch to 3200 post-T236 when canonical endpoint is decided
        baseURL = URL(string: ProcessInfo.processInfo.environment["KALSHI_API_URL"]
                      ?? "http://localhost:3457")!
        apiKey  = ProcessInfo.processInfo.environment["API_KEY"] ?? ""
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        session = URLSession(configuration: config)
    }

    // MARK: - Public API

    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task {
            while !Task.isCancelled {
                await fetchPairs()
                try? await Task.sleep(nanoseconds: UInt64(Self.pollIntervalSeconds * 1_000_000_000))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func refresh() async {
        await fetchPairs()
    }

    // MARK: - Fetch

    private func fetchPairs() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let data = try await get("/api/pipeline/pairs")
            let decoded = try JSONDecoder().decode(PipelinePairsResponse.self, from: data)
            opportunities = decoded.pairs.sorted { $0.confidence > $1.confidence }
            lastUpdated   = decoded.generatedAt
            error = nil
        } catch let e as ClientError {
            error = e
        } catch {
            self.error = .network(error.localizedDescription)
        }
    }

    // MARK: - HTTP

    private func get(_ path: String) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw ClientError.network("No HTTP response")
        }
        switch http.statusCode {
        case 200: return data
        case 401: throw ClientError.unauthorized
        case 404: throw ClientError.notFound(path)
        default:  throw ClientError.http(http.statusCode)
        }
    }

    // MARK: - Mock (T236 blocker fallback)

    static func withMock() -> PipelineClient {
        let client = PipelineClient()
        client.opportunities = Opportunity.mockData
        client.lastUpdated   = Date()
        return client
    }
}

// MARK: - Errors

enum ClientError: LocalizedError, Equatable {
    case network(String)
    case unauthorized
    case notFound(String)
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .network(let m):  return "Network error: \(m)"
        case .unauthorized:    return "Unauthorized — check API key"
        case .notFound(let p): return "Endpoint not found: \(p)"
        case .http(let code):  return "Server error \(code)"
        }
    }
}

// MARK: - Mock data (mirrors Phase 3 correlation_pairs.json structure)

extension Opportunity {
    static let mockData: [Opportunity] = [
        .mock(pairId: "BTCW-26-JUN-100K|ETHW-26-DEC-5K",
              marketA: "BTCW Jun 100K", marketB: "ETHW Dec 5K",
              cluster: "Crypto", confidence: 0.96,
              direction: .sellABuyB, zscore: 2.08),
        .mock(pairId: "SPX-26-Q2|NDX-26-Q2",
              marketA: "SPX Q2 2026", marketB: "NDX Q2 2026",
              cluster: "Finance", confidence: 0.87,
              direction: .buyABsellB, zscore: 1.54),
        .mock(pairId: "OIL-MAY|GAS-MAY",
              marketA: "Crude Oil May", marketB: "Nat Gas May",
              cluster: "Energy", confidence: 0.72,
              direction: .sellABuyB, zscore: -1.20),
    ]

    private static func mock(pairId: String, marketA: String, marketB: String,
                              cluster: String, confidence: Double,
                              direction: TradeDirection, zscore: Double) -> Opportunity {
        // Construct via JSON round-trip so the failable init stays single-path
        let iso = ISO8601DateFormatter().string(from: Date())
        let json = """
        {"pair_id":"\(pairId)","market_a":"\(marketA)","market_b":"\(marketB)",
         "cluster":"\(cluster)","confidence":\(confidence),
         "direction":"\(direction.rawValue)","spread_zscore":\(zscore),
         "timestamp":"\(iso)"}
        """.data(using: .utf8)!
        return try! JSONDecoder().decode(Opportunity.self, from: json)
    }
}
