# Semantic report references (RH-155)

The existing revision-checked document create/PATCH/version/restore API stores an atom node in
PROSEMIRROR_JSON. There is no copied image, client URL, inline code, or automatic latest-result substitution.

```json
{
  "type": "analysisResult",
  "attrs": {
    "blockId": "44444444-4444-4444-8444-444444444444",
    "reference": {
      "analysisId": "11111111-1111-4111-8111-111111111111",
      "executionId": "22222222-2222-4222-8222-222222222222",
      "outputId": "impedance-chart",
      "renderMode": "CHART"
    },
    "caption": "Figure 1. Saved experimental result."
  }
}
```

`outputId` is the unique persisted output name **within this execution**, not an image/artifact ID.
CHART, TABLE and SUMMARY respectively require CHART, TABLE and TEXT outputs. SUMMARY displays saved text;
it does not summarize arbitrary numbers. Attributes must have exactly the listed fields. Captions are inert text
(at most 1000 characters). A document has at most 50 references with unique UUID block IDs and bounded nesting.

On create, save, AI acceptance and restore, the server resolves each exact execution through workspace/source
authorization and requires a successful saved output. Failed/pending output references return CONFLICT, invalid
output/mode/metadata returns VALIDATION_FAILED, and inaccessible references return RESOURCE_NOT_FOUND.
No new schema/runtime dependency is introduced for documents. Existing version snapshots preserve old references.

Rendering reads the existing execution record and authenticated chart attachment. Provenance includes frozen
source version IDs, selected sheets/columns, hashes, code access and runtime identity. An out-of-date input banner
is informational; choosing another successful execution/output and saving is the explicit update flow. Concurrent
insertion is revision checked and requires reloading the destination before retrying. Viewer/archived report
affordances are read-only and the backend enforces write permissions.
