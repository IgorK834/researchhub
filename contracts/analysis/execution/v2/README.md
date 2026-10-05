# Structured scientific outputs v2 (RH-151)

The controlled execution manifest remains [v1](../v1/README.md). Sandbox **1.1.0** independently accepts both
result versions: existing v1 programs keep working; new plans use `computation-plan:3` and produce result v2.
Neither the manifest nor Python may configure containers or bind workspace/analysis identities.

TABLE and TEXT retain their v1 closed shapes and bounds. A v2 CHART has exactly:

```json
{
  "kind": "CHART",
  "name": "impedance-chart",
  "file": "impedance.png",
  "title": "Impedance magnitude versus frequency",
  "xAxis": {"label": "Frequency f", "unit": "Hz", "scale": "LOG"},
  "yAxis": {"label": "Impedance magnitude |Z|", "unit": "Ω", "scale": "LOG"},
  "series": [{
    "name": "|Z|", "tableName": "impedance-table",
    "xColumn": "Frequency (Hz)", "yColumn": "Impedance (Ω)", "yTransform": "ABS"
  }]
}
```

The result root has exactly `schemaVersion: "2.0"` and `outputs`. Title is nonblank, at most 200 characters.
Axes contain exactly label (1–128), unit (null or 1–40), scale (`LINEAR`/`LOG`). Series is a list of 0–10 unique
names (1–128), referring to actual numeric columns of a declared, saved TABLE; column names are 1–256 and table
names 1–100 characters. The y transformation is `IDENTITY` or `ABS`. Null pairs are omitted from the series;
logarithmic axes require positive values after transformation. Boolean/string cells cannot masquerade as numeric
series. Use an empty list when the chart has no feasible underlying result table. No generated point counts or
analysis/code references are accepted. Output order does not affect reference resolution.

Java derives row/point counts from the validated table. The persisted result stores title, axes, series and artifact
metadata. The [execution record](../../record/v1/README.md) binds source analysis ID, execution ID and generation code
SHA-256 on the server. The frontend consumes that typed contract and the authorized image endpoint; it never parses
stdout, SVG markup or Python to reconstruct chart metadata. Metadata describes the generated chart's declared
series; it is not a proof of its pixel contents.

Passive SVG is supported and preferred when its content satisfies the existing whitelist. It is displayed as an
image, never inserted into the DOM as arbitrary markup. PNG is the fallback, including the deterministic matplotlib
fixture whose normal SVG export requires unsupported CSS/DOCTYPE features. Existing byte/inode/JSON/row/log caps
and rejection of external resources, scripts, links and undeclared files continue to apply.

Legacy v1 charts retain their original image and record; `metadataAvailable=false`, null axes and an empty series
list explicitly mean those details were not recorded. Migration does not inspect Python or invent missing metadata.
