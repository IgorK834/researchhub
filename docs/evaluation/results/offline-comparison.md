# Paired evaluation comparison

| Metric | Baseline | Candidate | Delta | Direction |
| --- | ---: | ---: | ---: | --- |
| sourceRecallAtK | 1.0000 | 0.9821 | -0.0179 | higher |
| chunkRecallAtK | 1.0000 | n/a | n/a | higher |
| spanRecallAtK | 1.0000 | 0.9286 | -0.0714 | higher |
| mrrAtK | 0.8393 | 0.8274 | -0.0119 | higher |
| sourceHitRate | 1.0000 | 1.0000 | 0.0000 | higher |
| pageHitRate | 1.0000 | 0.8889 | -0.1111 | higher |
| citationValidity | 1.0000 | 1.0000 | 0.0000 | higher |
| expectedSourceCoverage | 1.0000 | 0.9821 | -0.0179 | higher |
| factCoverage | 0.9821 | 0.9286 | -0.0536 | higher |
| answerCorrectness | 0.9091 | 0.8485 | -0.0606 | higher |
| unsupportedClaimRate | 0.0000 | 0.0000 | 0.0000 | lower |
| statusCorrect | 0.9394 | 0.9394 | 0.0000 | higher |
| retrievalLatencyMsP95 | 0.2325 | 0.2613 | 0.0288 | lower |
| answerLatencyMsP95 | 0.3949 | 0.3290 | -0.0659 | lower |
| inputTokens | 10632.0000 | 8969.0000 | -1663.0000 | lower |
| outputTokens | 2016.0000 | 1179.0000 | -837.0000 | lower |
| totalTokens | 12648.0000 | 10148.0000 | -2500.0000 | lower |
| estimatedCost | n/a | n/a | n/a | lower |

Quality gate: FAIL
Regressions: sourceRecallAtK, spanRecallAtK, mrrAtK, pageHitRate, expectedSourceCoverage, factCoverage, answerCorrectness

n/a means unavailable or incompatible denominators; it is not a zero score.
Latency and cost deltas are descriptive; quality gates do not approve production adoption.
