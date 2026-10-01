package dev.researchhub.source.domain;

import dev.researchhub.shared.error.ConflictException;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * One uploaded file, as research material belonging to one workspace.
 *
 * <p>Invariants held here for every caller, and again by the {@code sources} table:
 *
 * <ul>
 *   <li>the workspace, uploader, file name, type, key, and hash are present,
 *   <li>the size is at least one byte and at most {@link #MAX_SIZE_BYTES_CEILING},
 *   <li>the hash is a lowercase SHA-256 hex digest,
 *   <li>the display name is present and within {@link SourceFilename#MAX_LENGTH},
 *   <li>the status only moves along {@link SourceStatus#next()}, and a failure has a bounded, user-safe summary.
 * </ul>
 *
 * <p><strong>Uploaded bytes never change.</strong> A source is the stable workspace object; each upload is an
 * immutable {@link SourceVersion}, and the file fields here are the projection of the <em>active</em> (latest)
 * version identified by {@link #activeVersionId()}. The only method that moves that projection is
 * {@link #replaceWith}, which selects a newly stored version; nothing returns a copy with different bytes for the
 * same version. What may change in place is how the workspace labels the source, how far processing has got, and the
 * explanation attached to a processing failure. Everything already derived from an older version (analyses, citations,
 * extractions) keeps pointing at that version, whose blob stays available.
 *
 * <p>{@code workspaceId} and {@code uploadedBy} are bare {@link UUID}s, as in {@code document}: this module does
 * not import {@code workspace.domain} or {@code user.domain}.
 */
public record Source(
        UUID id,
        UUID workspaceId,
        SourceFilename originalFilename,
        String displayName,
        SourceType sourceType,
        long sizeBytes,
        StorageKey storageKey,
        String contentSha256,
        SourceStatus status,
        String failureSummary,
        UUID uploadedBy,
        Instant createdAt,
        Instant updatedAt,
        UUID activeVersionId,
        int activeVersionNumber
) {

    /**
     * The largest source the schema accepts, 1 GiB. Mirrors {@code ck_sources_size_bytes}. The configured
     * per-source limit may be lower, never higher.
     */
    public static final long MAX_SIZE_BYTES_CEILING = 1L << 30;

    /** Mirrors {@code sources.failure_summary varchar(1000)}. */
    public static final int FAILURE_SUMMARY_MAX_LENGTH = 1000;

    private static final Pattern SHA256_HEX = Pattern.compile("^[0-9a-f]{64}$");

    public Source {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(originalFilename, "originalFilename must not be null");
        Objects.requireNonNull(sourceType, "sourceType must not be null");
        Objects.requireNonNull(storageKey, "storageKey must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(uploadedBy, "uploadedBy must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");

        Objects.requireNonNull(activeVersionId, "activeVersionId must not be null");
        if (activeVersionNumber < 1) {
            throw new IllegalArgumentException("active source version number must be at least 1");
        }

        if (sizeBytes < 1) {
            throw new IllegalArgumentException("an empty file is not a source");
        }
        if (sizeBytes > MAX_SIZE_BYTES_CEILING) {
            throw new IllegalArgumentException("a source must be at most " + MAX_SIZE_BYTES_CEILING + " bytes");
        }
        if (contentSha256 == null || !SHA256_HEX.matcher(contentSha256).matches()) {
            throw new IllegalArgumentException("contentSha256 must be a lowercase SHA-256 hex digest");
        }
        displayName = displayName == null ? null : displayName.strip();
        if (displayName == null || displayName.isEmpty()) {
            throw new IllegalArgumentException("a source needs a display name");
        }
        if (displayName.length() > SourceFilename.MAX_LENGTH) {
            throw new IllegalArgumentException(
                    "a display name must be at most " + SourceFilename.MAX_LENGTH + " characters");
        }

        failureSummary = failureSummary == null ? null : failureSummary.strip();
        if (status == SourceStatus.FAILED) {
            if (failureSummary == null || failureSummary.isEmpty()) {
                throw new IllegalArgumentException("a failed source needs a failure summary");
            }
            if (failureSummary.length() > FAILURE_SUMMARY_MAX_LENGTH) {
                throw new IllegalArgumentException("a failure summary must be at most "
                        + FAILURE_SUMMARY_MAX_LENGTH + " characters");
            }
        } else if (failureSummary != null) {
            throw new IllegalArgumentException("only a failed source may have a failure summary");
        }
    }

    /**
     * A source whose bytes were just stored, not yet persisted. {@link SourceStatus#UPLOADED}, displayed under its
     * original file name, with version 1 as its active version. Hibernate assigns the source id on insert.
     */
    public static Source uploaded(UUID workspaceId, SourceFilename originalFilename, SourceType sourceType,
                                  long sizeBytes, StorageKey storageKey, String contentSha256, UUID uploadedBy,
                                  Instant now) {
        return new Source(null, workspaceId, originalFilename, originalFilename.value(), sourceType,
                sizeBytes, storageKey, contentSha256, SourceStatus.UPLOADED, null, uploadedBy, now, now,
                UUID.randomUUID(), 1);
    }

    /** Selects a newly stored immutable input as the latest source version. */
    public Source replaceWith(UUID versionId, int versionNumber, SourceFilename filename, SourceType type,
                              long bytes, StorageKey key, String sha256, UUID replacementUploader, Instant now) {
        if (status != SourceStatus.READY && status != SourceStatus.FAILED) {
            throw new ConflictException("Source processing is already in progress");
        }
        if (versionNumber != activeVersionNumber + 1) {
            throw new IllegalArgumentException("source versions must be consecutive");
        }
        return new Source(id, workspaceId, filename, displayName, type, bytes, key, sha256,
                SourceStatus.UPLOADED, null, replacementUploader, createdAt, now,
                Objects.requireNonNull(versionId), versionNumber);
    }

    /** The canonical media type of the source's type, which is what is stored. */
    public String mediaType() {
        return sourceType.mediaType();
    }

    /**
     * A copy in {@code next} status.
     *
     * @throws ConflictException when the lifecycle does not allow the move — a ready source is not processed again
     */
    public Source moveTo(SourceStatus next, Instant now) {
        if (!status.canMoveTo(next)) {
            throw new ConflictException("A source that is " + status + " cannot become " + next);
        }
        if (next == SourceStatus.FAILED) {
            throw new IllegalArgumentException("use processingFailed to record a failure summary");
        }
        return new Source(id, workspaceId, originalFilename, displayName, sourceType, sizeBytes, storageKey,
                contentSha256, next, null, uploadedBy, createdAt, now, activeVersionId, activeVersionNumber);
    }

    /** Explicitly reprocesses the same immutable bytes after a terminal run. */
    public Source reprocess(Instant now) {
        if (status != SourceStatus.READY && status != SourceStatus.FAILED) {
            throw new ConflictException("Source processing is already in progress");
        }
        return new Source(id, workspaceId, originalFilename, displayName, sourceType, sizeBytes, storageKey,
                contentSha256, SourceStatus.PROCESSING, null, uploadedBy, createdAt, now,
                activeVersionId, activeVersionNumber);
    }

    /** Moves a processing source to {@link SourceStatus#FAILED} with the safe explanation shown to members. */
    public Source processingFailed(String summary, Instant now) {
        if (!status.canMoveTo(SourceStatus.FAILED)) {
            throw new ConflictException("A source that is " + status + " cannot become FAILED");
        }
        return new Source(id, workspaceId, originalFilename, displayName, sourceType, sizeBytes, storageKey,
                contentSha256, SourceStatus.FAILED, summary, uploadedBy, createdAt, now,
                activeVersionId, activeVersionNumber);
    }

}
