package dev.researchhub.source.domain;

import dev.researchhub.shared.error.ConflictException;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** One uploaded, immutable byte sequence belonging to a stable source. */
public record SourceVersion(
        UUID id,
        UUID sourceId,
        UUID workspaceId,
        int versionNumber,
        SourceFilename originalFilename,
        SourceType sourceType,
        long sizeBytes,
        StorageKey storageKey,
        String contentSha256,
        SourceStatus status,
        String failureSummary,
        UUID uploadedBy,
        Instant createdAt,
        Instant updatedAt
) {
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");

    public SourceVersion {
        Objects.requireNonNull(id);
        Objects.requireNonNull(sourceId);
        Objects.requireNonNull(workspaceId);
        Objects.requireNonNull(originalFilename);
        Objects.requireNonNull(sourceType);
        Objects.requireNonNull(storageKey);
        Objects.requireNonNull(status);
        Objects.requireNonNull(uploadedBy);
        Objects.requireNonNull(createdAt);
        Objects.requireNonNull(updatedAt);
        if (versionNumber < 1 || sizeBytes < 1 || sizeBytes > Source.MAX_SIZE_BYTES_CEILING
                || contentSha256 == null || !SHA256.matcher(contentSha256).matches()) {
            throw new IllegalArgumentException("invalid source version input");
        }
        failureSummary = failureSummary == null ? null : failureSummary.strip();
        if (status == SourceStatus.FAILED) {
            if (failureSummary == null || failureSummary.isEmpty()
                    || failureSummary.length() > Source.FAILURE_SUMMARY_MAX_LENGTH) {
                throw new IllegalArgumentException("a failed source version needs a bounded failure summary");
            }
        } else if (failureSummary != null) {
            throw new IllegalArgumentException("only a failed source version may have a failure summary");
        }
    }

    public static SourceVersion fromActiveSource(Source source) {
        if (source.id() == null || source.activeVersionId() == null || source.activeVersionNumber() < 1) {
            throw new IllegalArgumentException("source version identity is missing");
        }
        return new SourceVersion(source.activeVersionId(), source.id(), source.workspaceId(),
                source.activeVersionNumber(), source.originalFilename(), source.sourceType(), source.sizeBytes(),
                source.storageKey(), source.contentSha256(), source.status(), source.failureSummary(),
                source.uploadedBy(), source.updatedAt(), source.updatedAt());
    }

    public String mediaType() {
        return sourceType.mediaType();
    }

    public SourceVersion moveTo(SourceStatus next, Instant now) {
        if (!status.canMoveTo(next)) {
            throw new ConflictException("A source version that is " + status + " cannot become " + next);
        }
        if (next == SourceStatus.FAILED) {
            throw new IllegalArgumentException("use processingFailed to record a failure summary");
        }
        return new SourceVersion(id, sourceId, workspaceId, versionNumber, originalFilename, sourceType,
                sizeBytes, storageKey, contentSha256, next, null, uploadedBy, createdAt, now);
    }

    public SourceVersion reprocess(Instant now) {
        if (status != SourceStatus.READY && status != SourceStatus.FAILED) {
            throw new ConflictException("Source processing is already in progress");
        }
        return new SourceVersion(id, sourceId, workspaceId, versionNumber, originalFilename, sourceType,
                sizeBytes, storageKey, contentSha256, SourceStatus.PROCESSING, null, uploadedBy, createdAt, now);
    }

    public SourceVersion processingFailed(String summary, Instant now) {
        if (!status.canMoveTo(SourceStatus.FAILED)) {
            throw new ConflictException("A source version that is " + status + " cannot become FAILED");
        }
        return new SourceVersion(id, sourceId, workspaceId, versionNumber, originalFilename, sourceType,
                sizeBytes, storageKey, contentSha256, SourceStatus.FAILED, summary, uploadedBy, createdAt, now);
    }
}
