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
| citationValidity | 0.3571 | 28 |
| expectedSourceCoverage | 0.3571 | 28 |
| factCoverage | 0.2500 | 28 |
| answerCorrectness | 0.2121 | 33 |
| unsupportedClaimRate | 0.4000 | 10 |
| statusCorrect | 0.3030 | 33 |

Failures: 23 / 33.

| Timing | Mean ms | p50 ms | p95 ms | Measured |
| --- | ---: | ---: | ---: | ---: |
| retrievalLatencyMs | 0.7146 | 0.5524 | 1.8497 | 33 |
| answerLatencyMs | 8267.8928 | 1304.8699 | 57139.4527 | 33 |

| Usage | Total | Measured |
| --- | ---: | ---: |
| inputTokens | 16543.0000 | 10 |
| outputTokens | 725.0000 | 10 |
| totalTokens | 17268.0000 | 10 |
| estimatedCost | 0.0151 | 10 |

Cost: USD, configured rate revision `google-paid-standard-2026-10-08`.

| Case | Correct | Span recall | Unsupported | Error |
| --- | ---: | ---: | ---: | --- |
| rc-nominal / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| rc-resistance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-capacitance / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-formula / 0 | 0.0000 | 1.0000 | 1.0000 | - |
| rc-exponential / 0 | 0.0000 | 1.0000 | 1.0000 | - |
| rc-one-tau / 0 | 0.0000 | 1.0000 | 1.0000 | - |
| rc-initial / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-tolerances / 0 | 1.0000 | 1.0000 | 1.0000 | - |
| rc-interval / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| rc-noise / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-sampling / 0 | 1.0000 | 1.0000 | 0.0000 | - |
| protocol-duration / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| protocol-trials / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| protocol-log / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| protocol-provenance / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| smith-sample / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| lee-sample / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| smith-coefficient / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| lee-coefficient / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| compare-coefficients / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| compare-methods / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| smith-limit / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| lee-limit / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| safety-disconnect / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| polish-tau / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| polish-symbol / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| csv-schema / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
| missing-atlantis / 0 | 0.0000 | n/a | n/a | AI_UNAVAILABLE |
| foreign-calibration / 0 | 0.0000 | n/a | n/a | AI_UNAVAILABLE |
| empty-scope / 0 | 0.0000 | n/a | n/a | AI_UNAVAILABLE |
| csv-raw-values / 0 | 0.0000 | n/a | n/a | AI_UNAVAILABLE |
| source-instruction / 0 | 0.0000 | n/a | n/a | AI_UNAVAILABLE |
| foreign-authorized / 0 | 0.0000 | 1.0000 | n/a | AI_UNAVAILABLE |
