# Evaluation: baseline

Suite `researchhub-quality:1`; corpus `dc5496f8da7bbaf3c0233327590b96cd119d3629bc60f923aaae2330c0af887a`.
Index `fixture-hybrid`; top-K 6; scoring `curated-rules-1`; revision `RH-220-222`.

Curated deterministic support checks are conservative signals, not a general semantic proof.
Supplemental model judge scores are explicitly imperfect and never affect deterministic gates.

| Metric | Value | Eligible |
| --- | ---: | ---: |
| sourceRecallAtK | 1.0000 | 28 |
| chunkRecallAtK | 1.0000 | 28 |
| spanRecallAtK | 1.0000 | 28 |
| mrrAtK | 0.8393 | 28 |
| sourceHitRate | 1.0000 | 28 |
| pageHitRate | 1.0000 | 18 |
| citationValidity | 1.0000 | 30 |
| expectedSourceCoverage | 1.0000 | 28 |
| factCoverage | 0.9821 | 28 |
| answerCorrectness | 0.9091 | 33 |
| unsupportedClaimRate | 0.0000 | 30 |
| statusCorrect | 0.9394 | 33 |

Failures: 0 / 33.

| Timing | Mean ms | p50 ms | p95 ms | Measured |
| --- | ---: | ---: | ---: | ---: |
| retrievalLatencyMs | 0.1148 | 0.0955 | 0.2437 | 33 |
| answerLatencyMs | 0.2784 | 0.2666 | 0.4537 | 33 |

| Usage | Total | Measured |
| --- | ---: | ---: |
| inputTokens | 10632.0000 | 33 |
| outputTokens | 2016.0000 | 33 |
| totalTokens | 12648.0000 | 33 |
| estimatedCost | 0.0000 | 33 |

Cost: USD, configured rate revision `local-hardware-excluded-2026-10-08`.

| Case | Correct | Span recall | Unsupported | Error |
| --- | ---: | ---: | ---: | --- |
| rc-nominal / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-resistance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-capacitance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-formula / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-exponential / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-one-tau / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-initial / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-tolerances / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-interval / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-noise / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-sampling / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-duration / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-trials / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-log / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-provenance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| smith-sample / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| lee-sample / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| smith-coefficient / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| lee-coefficient / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| compare-coefficients / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| compare-methods / 0 | 0.0000 | 1.0000 | 0.0000 | - |
| smith-limit / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| lee-limit / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| safety-disconnect / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| polish-tau / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| polish-symbol / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| csv-schema / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| missing-atlantis / 0 | 1.0000 | n/a | n/a | - |
| foreign-calibration / 0 | 0.0000 | n/a | 0.0000 | - |
| empty-scope / 0 | 1.0000 | n/a | n/a | - |
| csv-raw-values / 0 | 1.0000 | n/a | n/a | - |
| source-instruction / 0 | 0.0000 | n/a | 0.0000 | - |
| foreign-authorized / 0 | 1.0000 | 1.0000 | 0.0000 | - |
