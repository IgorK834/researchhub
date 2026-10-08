# Evaluation: small-chunks-k3

Suite `researchhub-quality:1`; corpus `dc5496f8da7bbaf3c0233327590b96cd119d3629bc60f923aaae2330c0af887a`.
Index `fixture-hybrid`; top-K 3; scoring `curated-rules-1`; revision `RH-220-222`.

Curated deterministic support checks are conservative signals, not a general semantic proof.
Supplemental model judge scores are explicitly imperfect and never affect deterministic gates.

| Metric | Value | Eligible |
| --- | ---: | ---: |
| sourceRecallAtK | 0.9821 | 28 |
| chunkRecallAtK | n/a | 0 |
| spanRecallAtK | 0.9286 | 28 |
| mrrAtK | 0.8274 | 28 |
| sourceHitRate | 1.0000 | 28 |
| pageHitRate | 0.8889 | 18 |
| citationValidity | 1.0000 | 30 |
| expectedSourceCoverage | 0.9821 | 28 |
| factCoverage | 0.9286 | 28 |
| answerCorrectness | 0.8485 | 33 |
| unsupportedClaimRate | 0.0000 | 30 |
| statusCorrect | 0.9394 | 33 |

Failures: 0 / 33.

| Timing | Mean ms | p50 ms | p95 ms | Measured |
| --- | ---: | ---: | ---: | ---: |
| retrievalLatencyMs | 0.1137 | 0.0969 | 0.2613 | 33 |
| answerLatencyMs | 0.2239 | 0.2115 | 0.3290 | 33 |

| Usage | Total | Measured |
| --- | ---: | ---: |
| inputTokens | 8969.0000 | 33 |
| outputTokens | 1179.0000 | 33 |
| totalTokens | 10148.0000 | 33 |
| estimatedCost | n/a | 0 |

Cost: unavailable (no pinned pricing configured).

| Case | Correct | Span recall | Unsupported | Error |
| --- | ---: | ---: | ---: | --- |
| rc-nominal / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-resistance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-capacitance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-formula / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-exponential / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-one-tau / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-initial / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-tolerances / 0 | 0.0000 | 0.0000 | 0.0000 | - |
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
| compare-coefficients / 0 | 0.0000 | 0.5000 | 0.0000 | - |
| compare-methods / 0 | 0.0000 | 0.5000 | 0.0000 | - |
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
