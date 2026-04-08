// OpportunityFeedView.swift
// Kalshi Alpha — Main opportunity feed screen (SwiftUI)
// Screen 1 of 4 from mobile_arbitrage_companion_spec.md
//
// Usage (Xcode preview with mock data):
//   OpportunityFeedView()
//     .environmentObject(PipelineClient.withMock())

import SwiftUI

// MARK: - Feed

struct OpportunityFeedView: View {
    @EnvironmentObject var client: PipelineClient
    @State private var dismissed: Set<String> = []

    var visible: [Opportunity] {
        client.opportunities.filter { !dismissed.contains($0.pairId) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.Token.bg.ignoresSafeArea()

                if client.isLoading && client.opportunities.isEmpty {
                    ProgressView()
                        .tint(Color.Token.accent)
                } else if visible.isEmpty {
                    EmptyFeedView()
                } else {
                    feedList
                }
            }
            .navigationTitle("Opportunities")
            .navigationBarTitleDisplayMode(.large)
            .toolbarBackground(Color.Token.bg, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    lastUpdatedBadge
                }
            }
            .refreshable {
                await client.refresh()
            }
        }
        .onAppear { client.startPolling() }
        .onDisappear { client.stopPolling() }
    }

    // MARK: List

    private var feedList: some View {
        List {
            if let err = client.error {
                ErrorBanner(message: err.localizedDescription ?? "Unknown error")
                    .listRowBackground(Color.Token.surface)
                    .listRowSeparator(.hidden)
            }

            ForEach(visible) { opp in
                NavigationLink(destination: OpportunityDetailView(opportunity: opp)) {
                    OpportunityCardView(opportunity: opp)
                }
                .listRowBackground(Color.Token.surface)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: TokenSpacing.s2, leading: TokenSpacing.s4,
                                         bottom: TokenSpacing.s2, trailing: TokenSpacing.s4))
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        withAnimation { dismissed.insert(opp.pairId) }
                    } label: {
                        Label("Dismiss", systemImage: "xmark")
                    }
                    .tint(Color.Token.textDim)
                }
            }
        }
        .listStyle(.plain)
        .background(Color.Token.bg)
        .scrollContentBackground(.hidden)
    }

    private var lastUpdatedBadge: some View {
        Group {
            if let ts = client.lastUpdated {
                Text(ts, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(Color.Token.textDim)
            }
        }
    }
}

// MARK: - Opportunity Card

struct OpportunityCardView: View {
    let opportunity: Opportunity

    var body: some View {
        VStack(alignment: .leading, spacing: TokenSpacing.s2) {

            // Row 1: cluster badge + spread zscore
            HStack {
                ClusterBadge(cluster: opportunity.cluster)
                Spacer()
                Text(spreadLabel)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(spreadColor)
            }

            // Row 2: market pair
            HStack(spacing: TokenSpacing.s1) {
                Text(opportunity.marketA)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.Token.textPrimary)
                Image(systemName: "arrow.left.arrow.right")
                    .font(.caption)
                    .foregroundStyle(Color.Token.textSecondary)
                Text(opportunity.marketB)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.Token.textPrimary)
            }

            // Row 3: confidence bar + direction pill
            HStack(spacing: TokenSpacing.s3) {
                ConfidenceBar(confidence: opportunity.confidence)
                Spacer()
                DirectionPill(direction: opportunity.direction)
            }
        }
        .padding(TokenSpacing.s3)
        .background(Color.Token.surface)
        .clipShape(RoundedRectangle(cornerRadius: TokenRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TokenRadius.md)
                .strokeBorder(Color.Token.border, lineWidth: 1)
        )
    }

    private var spreadLabel: String {
        let sign = opportunity.spreadZscore >= 0 ? "+" : ""
        return "\(sign)\(String(format: "%.2f", opportunity.spreadZscore))σ"
    }

    private var spreadColor: Color {
        abs(opportunity.spreadZscore) >= 2.0 ? Color.Token.positive : Color.Token.textSecondary
    }
}

// MARK: - Sub-components

struct ClusterBadge: View {
    let cluster: String

    var body: some View {
        Text(cluster.replacingOccurrences(of: "_cluster", with: "").capitalized)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Color.Token.accent)
            .padding(.horizontal, TokenSpacing.s2)
            .padding(.vertical, 2)
            .background(Color.Token.accent.opacity(0.15))
            .clipShape(Capsule())
    }
}

struct ConfidenceBar: View {
    let confidence: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.Token.border)
                    Capsule()
                        .fill(Color.Token.confidence(confidence))
                        .frame(width: geo.size.width * confidence)
                }
            }
            .frame(width: 80, height: 4)

            Text("\(Int(confidence * 100))%")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Color.Token.confidence(confidence))
        }
    }
}

struct DirectionPill: View {
    let direction: TradeDirection

    var body: some View {
        Text(direction.shortLabel)
            .font(.caption2.weight(.medium))
            .foregroundStyle(Color.Token.textPrimary)
            .padding(.horizontal, TokenSpacing.s2)
            .padding(.vertical, 2)
            .background(Color.Token.surface2)
            .clipShape(RoundedRectangle(cornerRadius: TokenRadius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: TokenRadius.sm)
                    .strokeBorder(Color.Token.border, lineWidth: 1)
            )
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: TokenSpacing.s2) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.Token.warning)
            Text(message)
                .font(.caption)
                .foregroundStyle(Color.Token.textSecondary)
        }
        .padding(TokenSpacing.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.Token.warning.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: TokenRadius.sm))
    }
}

struct EmptyFeedView: View {
    var body: some View {
        VStack(spacing: TokenSpacing.s4) {
            Image(systemName: "chart.line.flattrend.xyaxis")
                .font(.system(size: 40))
                .foregroundStyle(Color.Token.textDim)
            Text("No opportunities")
                .font(.headline)
                .foregroundStyle(Color.Token.textPrimary)
            Text("High-confidence arbitrage pairs will appear here when the pipeline detects them.")
                .font(.subheadline)
                .foregroundStyle(Color.Token.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, TokenSpacing.s8)
        }
    }
}

// MARK: - Detail (stub — full spec in mobile_arbitrage_companion_spec.md)

struct OpportunityDetailView: View {
    let opportunity: Opportunity

    var body: some View {
        ZStack {
            Color.Token.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: TokenSpacing.s4) {

                    // Header
                    VStack(alignment: .leading, spacing: TokenSpacing.s2) {
                        ClusterBadge(cluster: opportunity.cluster)
                        Text("\(opportunity.marketA) ↔ \(opportunity.marketB)")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(Color.Token.textPrimary)
                    }
                    .padding(.horizontal, TokenSpacing.s4)

                    // Stats grid
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())],
                              spacing: TokenSpacing.s3) {
                        StatCell(label: "Confidence",
                                 value: "\(Int(opportunity.confidence * 100))%",
                                 color: Color.Token.confidence(opportunity.confidence))
                        StatCell(label: "Spread Dev",
                                 value: String(format: "%.2fσ", opportunity.spreadZscore),
                                 color: Color.Token.textPrimary)
                    }
                    .padding(.horizontal, TokenSpacing.s4)

                    // Direction block
                    VStack(spacing: TokenSpacing.s2) {
                        Text(opportunity.direction.label(
                            marketA: opportunity.marketA,
                            marketB: opportunity.marketB))
                            .font(.headline)
                            .foregroundStyle(Color.Token.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(TokenSpacing.s4)
                            .background(Color.Token.surface)
                            .clipShape(RoundedRectangle(cornerRadius: TokenRadius.md))
                            .overlay(RoundedRectangle(cornerRadius: TokenRadius.md)
                                .strokeBorder(Color.Token.border))
                    }
                    .padding(.horizontal, TokenSpacing.s4)

                    // Correlation note
                    Text("These markets move together \(Int(opportunity.confidence * 100))% of the time. The current spread is \(String(format: "%.2f", abs(opportunity.spreadZscore))) standard deviations from normal.")
                        .font(.subheadline)
                        .foregroundStyle(Color.Token.textSecondary)
                        .padding(.horizontal, TokenSpacing.s4)

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
                            UIPasteboard.general.string = opportunity.pairId
                        }
                        .buttonStyle(.bordered)
                        .tint(Color.Token.textSecondary)
                    }
                    .padding(.horizontal, TokenSpacing.s4)
                    .padding(.bottom, TokenSpacing.s8)
                }
                .padding(.top, TokenSpacing.s4)
            }
        }
        .navigationTitle("Opportunity Detail")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.Token.bg, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

struct StatCell: View {
    let label: String
    let value: String
    var color: Color = Color.Token.textPrimary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.Token.textSecondary)
            Text(value)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TokenSpacing.s3)
        .background(Color.Token.surface)
        .clipShape(RoundedRectangle(cornerRadius: TokenRadius.md))
        .overlay(RoundedRectangle(cornerRadius: TokenRadius.md)
            .strokeBorder(Color.Token.border))
    }
}

// MARK: - Previews

#Preview("Feed — mock data") {
    OpportunityFeedView()
        .environmentObject(PipelineClient.withMock())
}

#Preview("Feed — empty") {
    OpportunityFeedView()
        .environmentObject(PipelineClient())
}

#Preview("Card") {
    OpportunityCardView(opportunity: Opportunity.mockData[0])
        .padding()
        .background(Color.Token.bg)
}

#Preview("Detail") {
    NavigationStack {
        OpportunityDetailView(opportunity: Opportunity.mockData[0])
    }
}
