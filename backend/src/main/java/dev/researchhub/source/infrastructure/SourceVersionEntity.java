package dev.researchhub.source.infrastructure;

import dev.researchhub.source.domain.*;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

/** JPA projection of one immutable uploaded source version. */
@Entity
@Table(name = "source_versions")
public class SourceVersionEntity {
    @Id @Column(name = "id", nullable = false, updatable = false)
    private UUID id;
    @Column(name = "source_id", nullable = false, updatable = false)
    private UUID sourceId;
    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;
    @Column(name = "version_number", nullable = false, updatable = false)
    private int versionNumber;
    @Column(name = "original_filename", nullable = false, updatable = false, length = SourceFilename.MAX_LENGTH)
    private String originalFilename;
    @Column(name = "media_type", nullable = false, updatable = false, length = 128)
    private String mediaType;
    @Enumerated(EnumType.STRING) @Column(name = "source_type", nullable = false, updatable = false, length = 16)
    private SourceType sourceType;
    @Column(name = "size_bytes", nullable = false, updatable = false)
    private long sizeBytes;
    @Column(name = "storage_key", nullable = false, updatable = false, length = 255)
    private String storageKey;
    @Column(name = "content_sha256", nullable = false, updatable = false, length = 64)
    private String contentSha256;
    @Enumerated(EnumType.STRING) @Column(name = "status", nullable = false, length = 16)
    private SourceStatus status;
    @Column(name = "failure_summary", length = Source.FAILURE_SUMMARY_MAX_LENGTH)
    private String failureSummary;
    @Column(name = "uploaded_by", nullable = false, updatable = false)
    private UUID uploadedBy;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected SourceVersionEntity() {}

    public static SourceVersionEntity fromDomain(SourceVersion version) {
        var entity = new SourceVersionEntity();
        entity.id = version.id(); entity.sourceId = version.sourceId(); entity.workspaceId = version.workspaceId();
        entity.versionNumber = version.versionNumber(); entity.originalFilename = version.originalFilename().value();
        entity.mediaType = version.mediaType(); entity.sourceType = version.sourceType();
        entity.sizeBytes = version.sizeBytes(); entity.storageKey = version.storageKey().value();
        entity.contentSha256 = version.contentSha256(); entity.status = version.status();
        entity.failureSummary = version.failureSummary(); entity.uploadedBy = version.uploadedBy();
        entity.createdAt = version.createdAt(); entity.updatedAt = version.updatedAt();
        return entity;
    }

    public SourceVersion toDomain() {
        if (!sourceType.mediaType().equals(mediaType)) throw new IllegalStateException("invalid source version media type");
        return new SourceVersion(id, sourceId, workspaceId, versionNumber, new SourceFilename(originalFilename),
                sourceType, sizeBytes, new StorageKey(storageKey), contentSha256, status, failureSummary,
                uploadedBy, createdAt, updatedAt);
    }

    public UUID getId() { return id; }
}
