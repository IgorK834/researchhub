package dev.researchhub.source.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Public preview/confirm contract for bounded, local bibliography file migration. */
public final class BibliographyImportContracts {
    private BibliographyImportContracts() {}

    public enum Format { BIBTEX, RIS, CSL_JSON }
    public enum Origin { GENERIC, ZOTERO, MENDELEY }
    public enum RecordStatus { READY, DUPLICATE, CONFLICT, REJECTED }
    public enum MatchKind { SOURCE, BIBLIOGRAPHIC_ITEM }
    public enum MatchReason { DOI, METADATA }
    public enum ConfirmAction { CREATE, LINK_SOURCE, REPLACE_SOURCE, REPLACE_ITEM, SKIP }
    public enum Outcome { CREATED, LINKED, UPDATED, SKIPPED, REJECTED, DUPLICATE }

    public record Match(MatchKind kind, UUID id, String title, MatchReason reason,
                        List<String> conflictingFields, SourceBibliography existingBibliography,
                        List<String> tags, List<String> collections) {
        public Match {
            conflictingFields = conflictingFields == null ? List.of() : List.copyOf(conflictingFields);
            tags = List.copyOf(tags);
            collections = List.copyOf(collections);
        }
    }

    public record PreviewRecord(int recordNumber, String location, RecordStatus status, String itemType,
                                SourceBibliography bibliography, List<String> tags, List<String> collections,
                                int ignoredAttachments, List<String> issues, List<Match> matches) {
        public PreviewRecord {
            tags = tags == null ? List.of() : List.copyOf(tags);
            collections = collections == null ? List.of() : List.copyOf(collections);
            issues = issues == null ? List.of() : List.copyOf(issues);
            matches = matches == null ? List.of() : List.copyOf(matches);
        }
    }

    public record Preview(UUID id, UUID workspaceId, String fileName, String fileSha256, Format format,
                          Origin origin, String status, int totalRecords, int ready, int duplicates,
                          int conflicts, int rejected, List<PreviewRecord> records, Instant createdAt) {
        public Preview {
            records = List.copyOf(records);
        }
    }

    public record Decision(int recordNumber, ConfirmAction action, UUID targetId,
                           SourceBibliography acceptedBibliography, boolean mergeOrganization) {}

    public record ConfirmRequest(List<Decision> decisions) {
        public ConfirmRequest {
            decisions = decisions == null ? List.of() : List.copyOf(decisions);
        }
    }

    public record RecordResult(int recordNumber, Outcome outcome, MatchKind targetKind, UUID targetId) {}

    public record Result(UUID importId, int created, int linked, int updated, int skipped, int rejected,
                         int duplicates, List<RecordResult> records, Instant confirmedAt) {
        public Result {
            records = List.copyOf(records);
        }
    }

    /** Parser output before workspace deduplication. */
    public record ParsedRecord(int recordNumber, String location, String itemType,
                               SourceBibliography bibliography, List<String> tags, List<String> collections,
                               int ignoredAttachments, List<String> warnings) {
        public ParsedRecord {
            tags = tags == null ? List.of() : List.copyOf(tags);
            collections = collections == null ? List.of() : List.copyOf(collections);
            warnings = warnings == null ? List.of() : List.copyOf(warnings);
        }
    }

    public record ParseError(int recordNumber, String location, String message) {}

    public record ParsedBatch(List<ParsedRecord> records, List<ParseError> errors) {
        public ParsedBatch {
            records = List.copyOf(records);
            errors = List.copyOf(errors);
        }
    }

    public record Item(UUID id, UUID sourceId, String itemType, SourceBibliography bibliography,
                       List<String> tags, List<String> collections, Instant updatedAt) {}
    public record ItemPage(List<Item> items, int nextOffset) {}
    public record ItemUpdate(SourceBibliography bibliography, List<String> tags, List<String> collections,
                             Instant expectedUpdatedAt) {}
}
