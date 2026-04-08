// OpportunityFeedView.swift
// Kalshi Alpha — Mobile Arbitrage Companion (iOS / SwiftUI)
// Agent: judy | Sprint 9 self-directed | 2026-04-07
//
// Data source: GET /api/pipeline/pairs (port 3200)
// Card shape:  { pair_id, market_a, market_b, cluster, confidence,
//               direction, spread_zscore, timestamp }
// Tokens:      KalshiTokens.swift (Color.Token.*, TokenSpacing, TokenRadius)

import SwiftUI

// MARK: - Model

struct ArbitragePair: Identifiable, Decodable {
    var id: String { pair_id }
    let pair_id: String
    let market_a: String
    let market_b: String
    let cluster: String
    let confidence: Double
    let direction: String        // "buy_A_sell_B" | "sell_A_buy_B"
    let spread_zscore: Double
    let timestamp: String        // ISO 8601

    var directionLabel: String {
        direction == "buy_A_sell_B"
            ? "Buy \(shortName(market_a)) / Sell \(shortName(market_b))"
            : "Sell \(shortName(market_a)) / Buy \(shortName(market_b))"
    }

    var clusterLabel: String {
        cluster
            .replacingOccurrences(of: "_cluster", with: "")
            .capitalized
    }

    private func shortName(_ market: String) -> String {
        // "BTCW-26-JUN-100K|..." → "BTCW Jun 100K"
        let parts = market.split(separator: "-")
        guard parts.count >= 3 else { return market }
        return "\(parts[0]) \(parts[2].capitalized) \(parts.count > 3 ? String(parts[3]) : "")"
            .trimmingCharacters(in: .whitespaces)
    }
}

// MARK: - View Model

@MainActor
final class OpportunityFeedViewModel: ObservableObject {
    @Published var pairs: [ArbitragePair] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isOffline = false

    private let baseURL = "http://localhost:3200"
    private let apiKey: String = ProcessInfo.processInfo.environment["API_KEY"] ?? "dev"

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            var request = URLRequest(url: URL(string: "\(baseURL)/api/pipeline/pairs")!)
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.timeoutInterval = 10
            let (data, _) = try await URLSession.shared.data(for: request)
            let decoded = try JSONDecoder().decode([ArbitragePair].self, from: data)
            pairs = decoded.sorted { $0.confidence > $1.confidence }
            isOffline = false
        } catch let urlError as URLError where urlError.code == .notConnectedToInternet
                                              || urlError.code == .timedOut {
            isOffline = true          // show cached data with stale badge
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func dismiss(pair: ArbitragePair) {
        pairs.removeAll { $0.id == pair.id }
    }
}

// MARK: - Root Feed View

struct OpportunityFeedView: View {
    @StateObject private var vm = OpportunityFeedViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                Color.Token.bg.ignoresSafeArea()

                if vm.isLoading && vm.pairs.isEmpty {
                    ProgressView()
                        .tint(Color.Token.accent)
                } else if vm.pairs.isEmpty && !vm.isLoading {
                    EmptyFeedView()
                } else {
                    feedList
                }
            }
            .navigationTitle("Opportunities")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    if vm.isOffline {
                        Label("Offline", systemImage: "wifi.slash")
                            .foregroundColor(Color.Token.warning)
                            .font(.caption)
                    }
                }
            }
            .refreshable { await vm.load() }
            .task { await vm.load() }
        }
    }

    private var feedList: some View {
        List {
            if vm.isOffline {
                StaleBanner()
                    .listRowBackground(Color.Token.surface)
                    .listRowInsets(.init(top: 0, leading: 0, bottom: 0, trailing: 0))
            }
            ForEach(vm.pairs) { pair in
                NavigationLink(value: pair) {
                    OpportunityCard(pair: pair)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        vm.dismiss(pair: pair)
                    } label: {
                        Label("Dismiss", systemImage: "xmark")
                    }
                }
                .listRowBackground(Color.Token.surface)
                .listRowSeparatorTint(Color.Token.border)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationDestination(for: ArbitragePair.self) { pair in
            OpportunityDetailView(pair: pair)
        }
    }
}

// MARK: - Opportunity Card

struct OpportunityCard: View {
    let pair: ArbitragePair

    var body: some View {
        VStack(alignment: .leading, spacing: TokenSpacing.s2) {
            // Row 1: cluster badge + timestamp
            HStack {
                ClusterBadge(label: pair.clusterLabel)
                Spacer()
                Text(relativeTime(pair.timestamp))
                    .font(.caption2)
                    .foregroundColor(Color.Token.textDim)
            }

            // Row 2: market pair
            HStack(spacing: TokenSpacing.s2) {
                Text(pair.market_a)
                    .font(.caption)
                    .foregroundColor(Color.Token.textSecondary)
                Image(systemName: "arrow.left.arrow.right")
                    .font(.caption2)
                    .foregroundColor(Color.Token.textDim)
                Text(pair.market_b)
                    .font(.caption)
                    .foregroundColor(Color.Token.textSecondary)
            }
            .lineLimit(1)
            .truncationMode(.middle)

            // Row 3: confidence bar + spread
            HStack(alignment: .center, spacing: TokenSpacing.s3) {
                ConfidenceBar(score: pair.confidence)
                Spacer()
                Text(String(format: "+%.2fσ", pair.spread_zscore))
                    .font(.caption.monospacedDigit())
                    .foregroundColor(Color.Token.textPrimary)
            }

            // Row 4: direction pill
            DirectionPill(label: pair.directionLabel)
        }
        .padding(.vertical, TokenSpacing.s3)
        .padding(.horizontal, TokenSpacing.s2)
    }

    private func relativeTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return iso }
        let delta = Int(-date.timeIntervalSinceNow / 60)
        if delta < 1 { return "just now" }
        if delta < 60 { return "\(delta)m ago" }
        return "\(delta / 60)h ago"
    }
}

// MARK: - Sub-components

struct ClusterBadge: View {
    let label: String
    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, TokenSpacing.s2)
            .padding(.vertical, 2)
            .background(Color.Token.accent.opacity(0.15))
            .foregroundColor(Color.Token.accent)
            .clipShape(Capsule())
    }
}

struct ConfidenceBar: View {
    let score: Double
    var body: some View {
        HStack(spacing: TokenSpacing.s2) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.Token.border)
                    Capsule()
                        .fill(Color.Token.confidence(score))
                        .frame(width: geo.size.width * score)
                }
            }
            .frame(width: 80, height: 6)
            Text(String(format: "%.0f%%", score * 100))
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundColor(Color.Token.confidence(score))
        }
    }
}

struct DirectionPill: View {
    let label: String
    var body: some View {
        Text(label)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, TokenSpacing.s2)
            .padding(.vertical, 2)
            .background(Color.Token.surface2)
            .foregroundColor(Color.Token.textPrimary)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color.Token.border, lineWidth: 0.5))
    }
}

struct StaleBanner: View {
    var body: some View {
        HStack(spacing: TokenSpacing.s2) {
            Image(systemName: "wifi.slash")
            Text("Offline — showing last cached opportunities")
        }
        .font(.caption)
        .foregroundColor(Color.Token.warning)
        .frame(maxWidth: .infinity)
        .padding(TokenSpacing.s3)
        .background(Color.Token.warning.opacity(0.08))
    }
}

struct EmptyFeedView: View {
    var body: some View {
        VStack(spacing: TokenSpacing.s4) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 48))
                .foregroundColor(Color.Token.textDim)
            Text("No opportunities right now")
                .font(.headline)
                .foregroundColor(Color.Token.textPrimary)
            Text("Pull to refresh or wait for the next signal scan.")
                .font(.subheadline)
                .foregroundColor(Color.Token.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, TokenSpacing.s8)
        }
    }
}

// MARK: - Detail View (stub — full spec in mobile_arbitrage_companion_spec.md)

struct OpportunityDetailView: View {
    let pair: ArbitragePair

    var body: some View {
        ZStack {
            Color.Token.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: TokenSpacing.s6) {
                    // Header
                    VStack(alignment: .leading, spacing: TokenSpacing.s2) {
                        ClusterBadge(label: pair.clusterLabel)
                        HStack {
                            Text(pair.market_a)
                            Image(systemName: "arrow.left.arrow.right")
                                .foregroundColor(Color.Token.textDim)
                            Text(pair.market_b)
                        }
                        .font(.subheadline)
                        .foregroundColor(Color.Token.textSecondary)
                    }

                    // Stats grid
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())],
                              spacing: TokenSpacing.s4) {
                        StatCell(label: "Confidence",
                                 value: String(format: "%.1f%%", pair.confidence * 100),
                                 color: Color.Token.confidence(pair.confidence))
                        StatCell(label: "Spread (σ)",
                                 value: String(format: "+%.2f", pair.spread_zscore),
                                 color: Color.Token.textPrimary)
                    }

                    // Direction
                    VStack(alignment: .leading, spacing: TokenSpacing.s2) {
                        Text("Direction")
                            .font(.caption)
                            .foregroundColor(Color.Token.textSecondary)
                        DirectionPill(label: pair.directionLabel)
                    }

                    // Action bar
                    HStack(spacing: TokenSpacing.s3) {
                        Button("View on Dashboard") {
                            if let url = URL(string: "http://localhost:3199") {
                                UIApplication.shared.open(url)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color.Token.accent)

                        Button("Copy Pair ID") {
                            UIPasteboard.general.string = pair.pair_id
                        }
                        .buttonStyle(.bordered)
                        .tint(Color.Token.border)
                        .foregroundColor(Color.Token.textSecondary)
                    }
                }
                .padding(TokenSpacing.s4)
            }
        }
        .navigationTitle("Detail")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

struct StatCell: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: TokenSpacing.s1) {
            Text(label)
                .font(.caption)
                .foregroundColor(Color.Token.textSecondary)
            Text(value)
                .font(.title3.monospacedDigit().weight(.semibold))
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TokenSpacing.s3)
        .background(Color.Token.surface)
        .clipShape(RoundedRectangle(cornerRadius: TokenRadius.md))
        .overlay(RoundedRectangle(cornerRadius: TokenRadius.md)
            .stroke(Color.Token.border, lineWidth: 0.5))
    }
}

// MARK: - Preview

#Preview {
    OpportunityFeedView()
        .preferredColorScheme(.dark)
}
