# Math v1

`inlineMath` and `blockMath` are semantic atoms carrying `attrs.math`. Notation and accessibility text are generated from the closed AST and validated again by Java, browser and collaboration. Bounds: depth 12, 128 nodes, 8 operands, decimal length 40, integer powers ±8. No user TeX, macros, HTML or links. `verification` is null or a closed analysis/execution/output/step/input-hash reference. Spring accepts a reference only for a successful scoped PROBLEM attempt with CHECKED arithmetic verification and the exact saved step AST. A client-supplied verification label has no authority. Authoring defaults to null; automatic solution-package insertion remains CAI-14–15.

KaTeX 0.19.0 uses trust:false, strict:error, maxExpand:100, maxSize:10, fresh empty macros; a render failure shows escaped text. Clipboard HTML carries validated JSON, plain text carries accessible notation. Legacy documents stay unchanged. Export retains equations as labelled source/plain text in existing portable renderers.

Math atoms do not carry text marks: the current Yjs transport does not preserve marks on inline atoms. All three validators reject marked math, so comments/formatting are never silently discarded. Text comments, citations and formulas coexist in the same paragraph/table.
