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
| citationValidity | 0.0000 | 2 |
| expectedSourceCoverage | 0.0000 | 28 |
| factCoverage | 0.0000 | 28 |
| answerCorrectness | 0.1515 | 33 |
| unsupportedClaimRate | n/a | 0 |
| statusCorrect | 0.1515 | 33 |

Failures: 2 / 33.

| Timing | Mean ms | p50 ms | p95 ms | Measured |
| --- | ---: | ---: | ---: | ---: |
| retrievalLatencyMs | 0.6950 | 0.5035 | 1.8730 | 33 |
| answerLatencyMs | 764.9474 | 497.4677 | 2515.4430 | 33 |

| Usage | Total | Measured |
| --- | ---: | ---: |
| inputTokens | 52741.0000 | 33 |
| outputTokens | 862.0000 | 33 |
| totalTokens | 53603.0000 | 33 |
| estimatedCost | 0.0000 | 33 |

Cost: USD, configured rate revision `local-hardware-excluded-2026-10-08`.

| Case | Correct | Span recall | Unsupported | Error |
| --- | ---: | ---: | ---: | --- |
| rc-nominal / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-resistance / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-capacitance / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-formula / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-exponential / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-one-tau / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-initial / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-tolerances / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-interval / 0 | 0.0000 | 1.0000 | n/a | - |
| rc-noise / 0 | 0.0000 | 1.0000 | n/a | - |
| protocol-sampling / 0 | 0.0000 | 1.0000 | n/a | AI_OUTPUT_INVALID |
| protocol-duration / 0 | 0.0000 | 1.0000 | n/a | - |
| protocol-trials / 0 | 0.0000 | 1.0000 | n/a | - |
| protocol-log / 0 | 0.0000 | 1.0000 | n/a | - |
| protocol-provenance / 0 | 0.0000 | 1.0000 | n/a | - |
| smith-sample / 0 | 0.0000 | 1.0000 | n/a | - |
| lee-sample / 0 | 0.0000 | 1.0000 | n/a | - |
| smith-coefficient / 0 | 0.0000 | 1.0000 | n/a | - |
| lee-coefficient / 0 | 0.0000 | 1.0000 | n/a | - |
| compare-coefficients / 0 | 0.0000 | 1.0000 | n/a | - |
| compare-methods / 0 | 0.0000 | 1.0000 | n/a | - |
| smith-limit / 0 | 0.0000 | 1.0000 | n/a | - |
| lee-limit / 0 | 0.0000 | 1.0000 | n/a | - |
| safety-disconnect / 0 | 0.0000 | 1.0000 | n/a | - |
| polish-tau / 0 | 0.0000 | 1.0000 | n/a | - |
| polish-symbol / 0 | 0.0000 | 1.0000 | n/a | - |
| csv-schema / 0 | 0.0000 | 1.0000 | n/a | AI_OUTPUT_INVALID |
| missing-atlantis / 0 | 1.0000 | n/a | n/a | - |
| foreign-calibration / 0 | 1.0000 | n/a | n/a | - |
| empty-scope / 0 | 1.0000 | n/a | n/a | - |
| csv-raw-values / 0 | 1.0000 | n/a | n/a | - |
| source-instruction / 0 | 1.0000 | n/a | n/a | - |
| foreign-authorized / 0 | 0.0000 | 1.0000 | n/a | - |
