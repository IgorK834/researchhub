# Analysis presentation and integration

RH-305's `AnalysisWidgets.tsx` exports typed presentational components:
AnalysisStatusChip, AnalysisPipeline, AnalysisCodePanel, AnalysisResultTable, AnalysisChartFrame,
AnalysisFreshnessBanner and AnalysisListItem. Their props contain presentation values/callbacks only.
They import shared primitives/tokens, never API, router, planner, sandbox or plotting contracts.

Code is escaped, read-only and line numbered. Show/Hide supports either local or controlled state;
each panel has a distinct accessible ID. Tables paginate saved rows and highlight only the column
explicitly identified by the caller. They neither calculate nor guess a calculated column. ChartFrame
hosts caller-owned content and inert title/legend/caption/source text; it does not plot.
Freshness is supplied as a boolean; updating/opening uses callbacks without backend assumptions.

AnalysisStatus, AnalysisChart and ResultTable adapt persisted execution contracts to those primitives.
AnalysisOutputPicker, InsertAnalysisResult and the document NodeView own fetching/routing outside the
presentation module. Studio's Insert result action exists only for editable successful outputs.
The report uses the [semantic reference contract](../../../../../contracts/analysis/document-block/v1/README.md).
AI scope and navigation use the [mixed evidence contract](../../../../../contracts/ai/questions/v2/README.md).

References reviewed: Analysis_studio.pdf pages 1/3, Results,provenance&insert.pdf pages 1/3 and
Components&states.pdf page 2. Existing typography, yellow computation provenance, card spacing and
read-only/editor states are retained.

Each component has typed unit fixtures in AnalysisWidgets.test.tsx. Coverage has a dedicated 80%
line/branch/function/statement gate, in addition to the feature gate. Integration tests use the real
Tiptap schema and NodeView and verify saved reference metadata, explicit updates, failed lookups,
optimistic insertion conflicts and S/A navigation.
