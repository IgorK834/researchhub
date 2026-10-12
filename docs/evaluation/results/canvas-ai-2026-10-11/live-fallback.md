# Canvas AI fixed benchmark

Mode: live; 43 cases; skipped: 0.
Model: {'provider': 'gemini', 'name': 'gemini-3.8-flash', 'version': 'gemini-3.8-flash-ga-native-v2', 'structuredOutput': True, 'streaming': False}; image: `sha256:122799fc9cf0ad1e02f5fae3761e19e796c2561fa02ed7b22964e50adc1c94be`.

| Metric | Value |
| --- | ---: |
| cases | 43 |
| skipped | 0 |
| schemaRate | 1.0 |
| mathAccuracy | 0.68 |
| mathAnswerCoverage | 0.68 |
| refusalRate | 0.42857142857142855 |
| referenceIntegrity | 1.0 |
| injectionPassRate | 1.0 |
| groundedSupport | 0.25 |
| unsupportedClaimRate | 0.75 |
| refusalCoverage | 0.06976744186046512 |
| shortTextP50Ms | 2385.881479480304 |
| shortTextP95Ms | 3098.5638311190996 |
| problemP50Ms | 6888.885832973756 |
| problemP95Ms | 8668.034649617037 |
| inputTokens | 75447 |
| outputTokens | 29291 |
| usageKnown | 43 |

Gates: {'schemaRate': True, 'mathAccuracy': False, 'refusalRate': False, 'referenceIntegrity': True, 'injectionPassRate': True, 'groundedSupport': False, 'shortTextP95Ms': True, 'problemP95Ms': True, 'mathAnswerCoverage': False}
Cost USD: 0.1664265. Configured rate, not an invoice.

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
| quadratic-06 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| elimination-01 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| sqrt-01 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| pow-01 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| sin-01 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| cos-01 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| fraction-01 | CHECKED | False | SAFE_SANDBOX_REJECTION |
| problem-injection | CHECKED | False | SAFE_SANDBOX_REJECTION |
| missing-value | CLARIFICATION | False |  |
| missing-unit | CLARIFICATION | False |  |
| missing-domain | CLARIFICATION | False |  |
| missing-expression | CLARIFICATION | False |  |
| division-zero | SAFE_ERROR | True | SAFE_SANDBOX_REJECTION |
| incompatible-unit | SAFE_ERROR | True | SAFE_SANDBOX_REJECTION |
| canvas-caret | READY | True |  |
| canvas-expand | READY | True |  |
| canvas-followup | READY | True |  |
| canvas-grounded | READY | False |  |
| canvas-grounded-expand | READY | False |  |
| canvas-missing-theory | REFUSAL | True |  |
| canvas-missing-experiment | REFUSAL | True |  |
| canvas-injection-selected | READY | True |  |
| canvas-injection-history | READY | False |  |
| canvas-injection-refusal | REFUSAL | True |  |
| canvas-unicode | READY | True |  |
| canvas-long | READY | True |  |
