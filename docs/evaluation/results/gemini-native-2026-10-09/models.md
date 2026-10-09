# Demo model evaluation

Date: 2026-10-09

Dataset SHA-256: `c1ddab696539b15520049195b38e420a9e9319163b18aa708530b8e2af7f8b73`
Corpus SHA-256: `dc5496f8da7bbaf3c0233327590b96cd119d3629bc60f923aaae2330c0af887a`
Security fixture SHA-256: `337b0f4bddace29d818be1115fc820fe1a237348afc26f94d9315402b5446ce6`

| Model / version | Status | Recall@K | Valid citations | Grounded answers | Correct facts | Correct refusal | Valid output | Injection pass | p50 / p95 ms | USD / observation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| extractive-fixture / 1 | evaluated; thresholds missed | 100.00% | 100.00% | 96.43% | 90.91% | 60.00% | 100.00% | 33.33% | 0.3 / 1.2 | 0.000000 |
| qwen3:4b-instruct-2507-q4_K_M / 0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0 | unavailable | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| gemma3:1b-it-qat / b491bd3989c65bf74267bfb9e7d5fd0bf7b6548bc12f91a98df3c56865ce2f80 | unavailable | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| gemini-3.8-flash / gemini-3.8-flash-ga-native-v2 | evaluated; thresholds missed | 100.00% | 100.00% | 67.86% | 81.82% | 100.00% | 100.00% | 100.00% | 2185.8 / 3481.5 | 0.001453 |
| configured-deployment / configured-version | unavailable | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

Preferred candidate: `gemini-3-8-flash`. Adoption gate: FAIL.

Citation validity checks membership. Grounded answers additionally require all curated support rules and correct facts. These rules are conservative, not a general entailment proof. Unknown costs never pass the cost threshold. Latency includes failed attempts and bounded repair. Zero USD for local inference excludes hardware and electricity.

## Thresholds

- `sourceRecallAtK`: 0.95
- `spanRecallAtK`: 0.95
- `citationValidity`: 1.0
- `groundedAnswerRate`: 0.9
- `answerCorrectness`: 0.9
- `correctRefusalRate`: 1.0
- `schemaValidOutputRate`: 1.0
- `injectionPassRate`: 1.0
- `p95LatencyMs`: 8000.0
- `meanCostUsd`: 0.01

## Misses and availability

- `deterministic`: correctRefusalRate, injectionPassRate
- `qwen-local`: required-worker-environment-not-configured
- `gemma-local`: required-worker-environment-not-configured
- `gemini-3-8-flash`: groundedAnswerRate, answerCorrectness
- `foundry`: required-worker-environment-not-configured
