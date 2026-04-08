/**
 * Kalshi Alpha — Design Token Helpers (JS)
 * task_id: T992 | agent: charlie | generated: 2026-04-07
 *
 * Mirrors CSS custom properties in design_tokens.css.
 * Mirrors Swift Color.Token.* from agents/judy/output/platform_tokens/KalshiTokens.swift
 *
 * Usage (browser):  <script src="design_tokens.js"></script>
 *                   confidenceColor(0.92) → 'var(--color-positive)'
 * Usage (Node.js):  const { confidenceColor, TOKENS } = require('./design_tokens.js')
 */

const TOKENS = {
  bg:            '#0f172a',
  surface:       '#1e293b',
  surface2:      '#0d1117',
  border:        '#334155',
  textPrimary:   '#f8fafc',
  textSecondary: '#94a3b8',
  textDim:       '#64748b',
  positive:      '#22c55e',
  negative:      '#ef4444',
  warning:       '#f59e0b',
  accent:        '#3b82f6',
  purple:        '#8b5cf6',
};

/**
 * Returns the CSS custom property for a confidence score.
 * Thresholds match Phase 3 arbitrage_confidence field.
 * Identical logic to Swift Color.Token.confidence() and Android ConfidenceColor.kt.
 *
 * @param {number} score — 0.0 to 1.0
 * @returns {string} CSS custom property reference
 */
function confidenceColor(score) {
  if (score >= 0.90) return 'var(--color-positive)';
  if (score >= 0.75) return 'var(--color-warning)';
  return 'var(--color-negative)';
}

/**
 * Returns the hex value for a confidence score (useful in canvas/SVG contexts).
 * @param {number} score — 0.0 to 1.0
 * @returns {string} hex color
 */
function confidenceHex(score) {
  if (score >= 0.90) return TOKENS.positive;
  if (score >= 0.75) return TOKENS.warning;
  return TOKENS.negative;
}

// Node.js + browser compat
if (typeof module !== 'undefined') {
  module.exports = { TOKENS, confidenceColor, confidenceHex };
}
