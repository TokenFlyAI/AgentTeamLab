# Sprint 4 Pipeline Validation Paths

## Handoff Map

| Task | Agent | Reads | Writes | Handoff |
|------|-------|-------|--------|---------|
| T578 | Bob | local generator inputs | `agents/bob/output/mock_kalshi_markets.json` | DM Grace |
| T579 | Grace | `agents/bob/output/mock_kalshi_markets.json` | `agents/grace/output/filtered_markets.json` | DM Ivan |
| T580 | Ivan | `agents/grace/output/filtered_markets.json` | `agents/ivan/output/market_clusters.json` | DM Bob |
| T581 | Bob | `agents/ivan/output/market_clusters.json` | `agents/bob/output/correlation_pairs.json` | DM Dave |
| T582 | Dave | `agents/bob/output/correlation_pairs.json` | `agents/dave/output/pipeline_report.md` | DM Tina + Olivia |
| T583 | Tina | `agents/dave/output/pipeline_report.md` plus upstream files | `agents/tina/output/sprint4_qa_report.md` | DM Alice |
| T584 | Olivia | `agents/tina/output/sprint4_qa_report.md` plus status files | `agents/olivia/output/sprint4_retro.md` | DM Alice |

## Chain

Bob -> Grace -> Ivan -> Bob -> Dave -> Tina -> Olivia

## Notes

- Consensus D7 already exists in the shared board.
- Shared `public/knowledge.md` could not be updated directly from the current sandbox, so this file is the writable fallback.
