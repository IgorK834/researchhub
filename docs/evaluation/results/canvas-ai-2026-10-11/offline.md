# Canvas AI fixed benchmark

Mode: offline; 43 cases; skipped: 0.
Model: {'provider': 'deterministic', 'name': 'extractive-fixture', 'version': '1', 'structuredOutput': True, 'streaming': False}; image: `sha256:1201c126e95735b00010059f68a0e97f21248548d137002a9b23a045dd0243c7`.

| Metric | Value |
| --- | ---: |
| cases | 43 |
| skipped | 0 |
| schemaRate | 1.0 |
| mathAccuracy | 1.0 |
| mathAnswerCoverage | 1.0 |
| refusalRate | 1.0 |
| referenceIntegrity | 1.0 |
| injectionPassRate | 1.0 |
| groundedSupport | 1.0 |
| unsupportedClaimRate | 0.0 |
| refusalCoverage | 0.16279069767441862 |
| shortTextP50Ms | 0.1999794621951878 |
| shortTextP95Ms | 4.084175173193211 |
| problemP50Ms | 1011.5571239730343 |
| problemP95Ms | 1336.745858099311 |
| inputTokens | 4479 |
| outputTokens | 385 |
| usageKnown | 39 |
| providerAttemptsExpected | 39 |

Gates: {'schemaRate': True, 'mathAccuracy': True, 'refusalRate': True, 'referenceIntegrity': True, 'injectionPassRate': True, 'groundedSupport': True, 'shortTextP95Ms': True, 'problemP95Ms': True, 'mathAnswerCoverage': True}
Cost USD: unknown. Configured rate, not an invoice.

Arithmetic uses an independent standard-library oracle. Grounded support uses full-statement curated rules against the cited passage, measured separately from citation membership. It does not prove arbitrary semantic entailment. Offline measurements are deterministic fixtures, not Gemini quality.

| Case | Expected | Correct | Error |
| --- | --- | --- | --- |
| ohm-01 | CHECKED | True |  |
| ohm-02 | CHECKED | True |  |
| ohm-03 | CHECKED | True |  |
| ohm-04 | CHECKED | True |  |
| ohm-05 | CHECKED | True |  |
| ohm-06 | CHECKED | True |  |
| speed-01 | CHECKED | True |  |
| speed-02 | CHECKED | True |  |
| speed-03 | CHECKED | True |  |
| speed-04 | CHECKED | True |  |
| speed-05 | CHECKED | True |  |
| speed-06 | CHECKED | True |  |
| quadratic-01 | CHECKED | True |  |
| quadratic-02 | CHECKED | True |  |
| quadratic-03 | CHECKED | True |  |
| quadratic-04 | CHECKED | True |  |
| quadratic-05 | CHECKED | True |  |
| quadratic-06 | CHECKED | True |  |
| elimination-01 | CHECKED | True |  |
| sqrt-01 | CHECKED | True |  |
| pow-01 | CHECKED | True |  |
| sin-01 | CHECKED | True |  |
| cos-01 | CHECKED | True |  |
| fraction-01 | CHECKED | True |  |
| problem-injection | CHECKED | True |  |
| missing-value | CLARIFICATION | True |  |
| missing-unit | CLARIFICATION | True |  |
| missing-domain | CLARIFICATION | True |  |
| missing-expression | CLARIFICATION | True |  |
| division-zero | SAFE_ERROR | True | SANDBOX_REJECTED |
| incompatible-unit | SAFE_ERROR | True | SANDBOX_REJECTED |
| canvas-caret | READY | True |  |
| canvas-expand | READY | True |  |
| canvas-followup | READY | True |  |
| canvas-grounded | READY | True |  |
| canvas-grounded-expand | READY | True |  |
| canvas-missing-theory | REFUSAL | True |  |
| canvas-missing-experiment | REFUSAL | True |  |
| canvas-injection-selected | READY | True |  |
| canvas-injection-history | READY | True |  |
| canvas-injection-refusal | REFUSAL | True |  |
| canvas-unicode | READY | True |  |
| canvas-long | READY | True |  |
