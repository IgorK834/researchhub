package dev.researchhub.source.infrastructure;

import dev.researchhub.source.domain.Source;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceStatus;
import dev.researchhub.source.domain.SourceType;
import dev.researchhub.source.domain.StorageKey;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA mapping for the {@code sources} table created by {@code V8__create_sources.sql}.
 *
 * <p>Every column describing the original input is {@code updatable = false}, so Hibernate never writes one after
 * the insert; {@code tg_sources_original_is_immutable} refuses it from anybody else. Only {@code display_name},
 * {@code status}, and {@code updated_at} are updatable.
 *
 * <p>{@code media_type} is written from the source type, never from a client, and checked against it on the way
 * back: a row whose pair disagrees would already have been refused by {@code ck_sources_media_type_matches_type}.
 */
@Entity
@Table(name = "sources")
public class SourceEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "original_filename", nullable = false, updatable = false, length = SourceFilename.MAX_LENGTH)
    private String originalFilename;

    @Column(name = "display_name", nullable = false, length = SourceFilename.MAX_LENGTH)
    private String displayName;

    @Column(name = "media_type", nullable = false, updatable = false, length = 128)
    private String mediaType;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", nullable = false, updatable = false, length = 16)
    private SourceType sourceType;

    @Column(name = "size_bytes", nullable = false, updatable = false)
    private long sizeBytes;

    @Column(name = "storage_key", nullable = false, updatable = false, length = 255)
    private String storageKey;

    @Column(name = "content_sha256", nullable = false, updatable = false, length = 64)
    private String contentSha256;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private SourceStatus status;

    @Column(name = "uploaded_by", nullable = false, updatable = false)
    private UUID uploadedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Required by JPA. Application code uses {@link #fromDomain(Source)}. */
    protected SourceEntity() {
    }

    public static SourceEntity fromDomain(Source source) {
        SourceEntity entity = new SourceEntity();
        entity.id = source.id();
        entity.workspaceId = source.workspaceId();
        entity.originalFilename = source.originalFilename().value();
        entity.displayName = source.displayName();
        entity.mediaType = source.mediaType();
        entity.sourceType = source.sourceType();
        entity.sizeBytes = source.sizeBytes();
        entity.storageKey = source.storageKey().value();
        entity.contentSha256 = source.contentSha256();
        entity.status = source.status();
        entity.uploadedBy = source.uploadedBy();
        entity.createdAt = source.createdAt();
        entity.updatedAt = source.updatedAt();
        return entity;
    }

    public Source toDomain() {
        if (!sourceType.mediaType().equals(mediaType)) {
            throw new IllegalStateException("source " + id + " has media type " + mediaType
                    + ", which is not the media type of " + sourceType);
        }
        return new Source(id, workspaceId, new SourceFilename(originalFilename), displayName, sourceType, sizeBytes,
                new StorageKey(storageKey), contentSha256, status, uploadedBy, createdAt, updatedAt);
    }

    public UUID getId() {
        return id;
    }

    public UUID getWorkspaceId() {
        return workspaceId;
    }

}
