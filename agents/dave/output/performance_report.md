# live_runner.js Pipeline Performance Report

**Task:** T409 — Benchmark live_runner.js end-to-end latency  
**Author:** Dave (Full Stack Engineer)  
**Date:** 2026-04-03  
**Iterations:** 10  

---

## Summary

| Metric | Value (ms) |
|--------|------------|
| Total p50 | 2.40 |
| Total p95 | 10.88 |
| Total avg | 3.34 |
| Total max | 10.88 |
| Target (<2s p95) | ✅ PASS |

---

## Stage Breakdown

| Stage | p50 (ms) | p95 (ms) | avg (ms) | max (ms) |
|-------|----------|----------|----------|----------|
| 1. Fetch Markets | 0.00 | 0.18 | 0.03 | 0.18 |
| 2. Select Markets | 0.002 | 0.010 | 0.003 | 0.010 |
| 3. Enrich Markets | 0.06 | 0.87 | 0.15 | 0.87 |
| 4. Settlement Check | 0.01 | 0.75 | 0.09 | 0.75 |
| 5. Run Strategies | 0.01 | 0.16 | 0.03 | 0.16 |
| 6. Size Positions | 0.013 | 0.122 | 0.023 | 0.122 |
| 7. Risk Check | 2.11 | 8.30 | 2.80 | 8.30 |
| 8. Execute / Write | 0.17 | 0.47 | 0.21 | 0.47 |

---

## Bottlenecks (>15% of total runtime)

- **stage7_riskCheck**: 2.80ms avg (83.8% of total)

---

## Findings

1. **Mock fallback is fast**: With deterministic mock data, the entire pipeline completes in ~3ms on average.
2. **Stage 3 (Enrich Markets)** and **Stage 7 (Risk Check)** are the heaviest non-trivial stages due to sequential async/DB operations.
3. **Stage 5 (Run Strategies)** is efficient; SignalEngine.scan() runs in <1ms even with 8 markets.
4. **I/O bound**: File writes (run_counter.txt, trade_signals.json) and DB reads (risk manager, paper trades) contribute the most variance.

---

## Recommendations

1. **Parallelize candle fetching**: Stage 3 loops markets sequentially. Use `Promise.all()` to fetch candles in parallel when hitting the live Kalshi API.
2. **Cache risk summary**: Stage 7 reads the risk DB on every run. Cache the summary in-memory for the duration of the batch.
3. **Batch DB writes**: Stage 8 writes multiple files synchronously. Batch or async-ify I/O for better throughput.
4. **Pre-warm mock data**: If mock fallback is used in CI, pre-generate candle histories to eliminate deterministic RNG overhead.

---

## Raw Data

```json
[
  {
    "stage1_fetchMarkets": 0.18445968627929688,
    "stage2_selectMarkets": 0.00958251953125,
    "stage3_enrichMarkets": 0.8658351898193359,
    "stage4_settlementCheck": 0.7496261596679688,
    "stage5_runStrategies": 0.15758323669433594,
    "stage6_sizePositions": 0.12187385559082031,
    "stage7_riskCheck": 8.297124862670898,
    "stage8_executeWrite": 0.46820831298828125,
    "total": 10.87962532043457
  },
  {
    "stage1_fetchMarkets": 0.06712532043457031,
    "stage2_selectMarkets": 0.0025424957275390625,
    "stage3_enrichMarkets": 0.07287406921386719,
    "stage4_settlementCheck": 0.04975128173828125,
    "stage5_runStrategies": 0.014499664306640625,
    "stage6_sizePositions": 0.01445770263671875,
    "stage7_riskCheck": 2.657541275024414,
    "stage8_executeWrite": 0.22345733642578125,
    "total": 3.1095848083496094
  },
  {
    "stage1_fetchMarkets": 0.002498626708984375,
    "stage2_selectMarkets": 0.0017910003662109375,
    "stage3_enrichMarkets": 0.05825042724609375,
    "stage4_settlementCheck": 0.006084442138671875,
    "stage5_runStrategies": 0.05362510681152344,
    "stage6_sizePositions": 0.009082794189453125,
    "stage7_riskCheck": 2.4432926177978516,
    "stage8_executeWrite": 0.17441749572753906,
    "total": 2.7528324127197266
  },
  {
    "stage1_fetchMarkets": 0.0027923583984375,
    "stage2_selectMarkets": 0.0018749237060546875,
    "stage3_enrichMarkets": 0.05470848083496094,
    "stage4_settlementCheck": 0.006500244140625,
    "stage5_runStrategies": 0.011623382568359375,
    "stage6_sizePositions": 0.010332107543945312,
    "stage7_riskCheck": 2.207000732421875,
    "stage8_executeWrite": 0.15366744995117188,
    "total": 2.4520416259765625
  },
  {
    "stage1_fetchMarkets": 0.002498626708984375,
    "stage2_selectMarkets": 0.001583099365234375,
    "stage3_enrichMarkets": 0.05637550354003906,
    "stage4_settlementCheck": 0.00612640380859375,
    "stage5_runStrategies": 0.008749008178710938,
    "stage6_sizePositions": 0.008790969848632812,
    "stage7_riskCheck": 2.113292694091797,
    "stage8_executeWrite": 0.18987464904785156,
    "total": 2.390165328979492
  },
  {
    "stage1_fetchMarkets": 0.00316619873046875,
    "stage2_selectMarkets": 0.0019168853759765625,
    "stage3_enrichMarkets": 0.05454254150390625,
    "stage4_settlementCheck": 0.006290435791015625,
    "stage5_runStrategies": 0.007167816162109375,
    "stage6_sizePositions": 0.0089569091796875,
    "stage7_riskCheck": 1.977499008178711,
    "stage8_executeWrite": 0.16979217529296875,
    "total": 2.2322921752929688
  },
  {
    "stage1_fetchMarkets": 0.0024585723876953125,
    "stage2_selectMarkets": 0.0014591217041015625,
    "stage3_enrichMarkets": 0.1598339080810547,
    "stage4_settlementCheck": 0.0066680908203125,
    "stage5_runStrategies": 0.012166976928710938,
    "stage6_sizePositions": 0.014665603637695312,
    "stage7_riskCheck": 2.0105857849121094,
    "stage8_executeWrite": 0.15724945068359375,
    "total": 2.3713760375976562
  },
  {
    "stage1_fetchMarkets": 0.002666473388671875,
    "stage2_selectMarkets": 0.0029582977294921875,
    "stage3_enrichMarkets": 0.06758308410644531,
    "stage4_settlementCheck": 0.009082794189453125,
    "stage5_runStrategies": 0.017416000366210938,
    "stage6_sizePositions": 0.012958526611328125,
    "stage7_riskCheck": 2.086334228515625,
    "stage8_executeWrite": 0.23183441162109375,
    "total": 2.4350833892822266
  },
  {
    "stage1_fetchMarkets": 0.0028743743896484375,
    "stage2_selectMarkets": 0.0015411376953125,
    "stage3_enrichMarkets": 0.062374114990234375,
    "stage4_settlementCheck": 0.05066680908203125,
    "stage5_runStrategies": 0.014081954956054688,
    "stage6_sizePositions": 0.0136260986328125,
    "stage7_riskCheck": 2.0229148864746094,
    "stage8_executeWrite": 0.1978759765625,
    "total": 2.368875503540039
  },
  {
    "stage1_fetchMarkets": 0.0025424957275390625,
    "stage2_selectMarkets": 0.0012493133544921875,
    "stage3_enrichMarkets": 0.05928993225097656,
    "stage4_settlementCheck": 0.0052089691162109375,
    "stage5_runStrategies": 0.016874313354492188,
    "stage6_sizePositions": 0.015167236328125,
    "stage7_riskCheck": 2.1513328552246094,
    "stage8_executeWrite": 0.140625,
    "total": 2.395000457763672
  }
]
```

---

*Report generated by benchmark_live_runner.js*
