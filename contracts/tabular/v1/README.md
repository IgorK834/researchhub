# CSV data profile v1

`csv-profile.json` and `csv-profile.schema.json` define the additive nullable `workbook.csvProfile`
attribute of extraction v4. Names/types/missing counts refer to the bounded scan, not a guaranteed
schema of the complete file. Row count excludes the assumed header and blank prefix; null means the
scan was limited. Empty/whitespace-only cells are missing. Sample values remain strings in the existing
bounded sheet previews. Index policy is schema-only.

The shared complete fixture is [`processing/v4/source-ingest-result-csv.json`](../../processing/v4/source-ingest-result-csv.json).
Java and Python validate it; React renders its data profile and preview. This profile adds no database
or file access to model providers. Original file hash, source identity and sheet/retrieval provenance
remain in the surrounding extraction envelope. Full semantics and upgrade strategy:
[CSV data assets](../../../docs/development/csv-data-assets.md).
