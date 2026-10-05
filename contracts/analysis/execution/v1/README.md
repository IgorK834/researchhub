# Execution v1

The controlled manifest remains current. New scientific plans produce [result v2](../v2/README.md), adding
structured chart metadata while retaining v1 result compatibility. Durable inspection uses the
[execution record v1](../../record/v1/README.md).

This boundary consumes an accepted immutable computation plan. The trusted Java runner constructs the manifest;
clients and generated Python cannot set images, host paths, secrets, mounts, networking or container options.

`/execution/manifest.json` has exactly these fields:

```json
{
  "schemaVersion": "1.0",
  "inputs": [{
    "sourceVersionId": "00000000-0000-4000-8000-000000000002",
    "format": "CSV",
    "file": "/inputs/00000000-0000-4000-8000-000000000002.csv",
    "sha256": "<64 lowercase hexadecimal characters>"
  }],
  "outputs": [{"name": "impedance-table", "kind": "TABLE"}, {"name": "impedance-chart", "kind": "CHART"}]
}
```

The code is `/execution/code.py`. Input UUIDs are distinct and formats are `CSV`/`XLSX`; the exact canonical path and
SHA-256 must match mounted content. There are 1–5 inputs and 1–10 outputs with unique names (maximum 100 characters).
The manifest is at most 64 KiB and code at most 32,000 UTF-8 bytes. All mounts are server-controlled and read-only.

Generated code writes `/outputs/result.json` and its declared chart files. The result has exactly `schemaVersion`
and `outputs`; each output uses one of these closed shapes:

```json
{
  "schemaVersion": "1.0",
  "outputs": [
    {"name": "impedance-table", "kind": "TABLE", "columns": ["frequency (Hz)", "impedance (ohm)"], "rows": [[100, 40], [200, 25]]},
    {"name": "impedance-chart", "kind": "CHART", "file": "impedance.png"}
  ]
}
```

`TEXT` has exactly `name`, `kind` and `text`. It is execution output, not a substituted model narrative. Names and
kinds must match every declared plan output exactly once; extra/missing outputs or files are failures. Numeric table
values originate from this result. Planning summaries and model candidates remain separate in the planning audit.

Limits: result JSON 1 MiB; up to 100 unique column names (256 characters each), 10,000 rows and 100,000 total cells;
cells are null, boolean, finite number or string of at most 1,024 characters; text 65,536 characters; each chart
8 MiB; all files 16 MiB. Chart names are simple filenames ending `.png`/`.svg`. PNG signatures and passive SVG
content are validated independently by Python and Java. Links, devices, nested paths, external SVG resources and
active content are rejected. JSON duplicate keys and nonfinite numbers are rejected.

Container tmpfs byte/inode limits bound writes independently of result validation. Captured stdout and stderr have
independent 64 KiB retention caps and continue draining after truncation. An execution deadline terminates the entire
container, including background children; a trusted collector pauses it before reading output.

Persisted public execution/artifact contracts live in `ExecutionContracts.java`; controlled-launch contracts live in
`SandboxRunner.java`. History includes immutable input and code hashes, plan identity, runtime/image identity,
timestamps, actor, explicit attempt number, result and structured failure. Artifact bytes are reachable only through
the corresponding workspace/analysis/execution endpoint. See [analysis-execution.md](../../../../docs/development/analysis-execution.md).
