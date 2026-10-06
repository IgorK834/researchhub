package dev.researchhub.document.infrastructure;

import dev.researchhub.document.domain.DocumentContent;
import dev.researchhub.document.domain.DocumentContentFormat;
import dev.researchhub.document.domain.DocumentVersion;
import dev.researchhub.document.domain.DocumentVersionReason;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA mapping for the {@code document_versions} table created by {@code V7__create_document_versions.sql}.
 *
 * <p>{@link Immutable}, and every column {@code updatable = false}: Hibernate never issues an {@code UPDATE}
 * for a snapshot. That is the application's half of the rule. The database's half is
 * {@code tg_document_versions_immutable}, which refuses {@code UPDATE} and {@code DELETE} from anybody.
 */
@Entity
@Immutable
@Table(name = "document_versions")
public class DocumentVersionEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "document_id", nullable = false, updatable = false)
    private UUID documentId;

    @Column(name = "revision", nullable = false, updatable = false)
    private long revision;

    @Enumerated(EnumType.STRING)
    @Column(name = "content_format", nullable = false, updatable = false, length = 32)
    private DocumentContentFormat contentFormat;

    /** Stored JSON text, as on {@link DocumentEntity}: the backend copies it and does not interpret it. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "content", nullable = false, updatable = false)
    private String content;

    @Enumerated(EnumType.STRING)
    @Column(name = "reason", nullable = false, updatable = false, length = 32)
    private DocumentVersionReason reason;

    @Column(name = "restored_from_version_id", updatable = false)
    private UUID restoredFromVersionId;

    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "name", updatable = false, length = 120)
    private String name;
    @Column(name = "actor_name", updatable = false, length = 200)
    private String actorName;
    @Column(name = "yjs_state", updatable = false)
    private byte[] yjsState;
    @Column(name = "state_sha256", updatable = false, length = 64)
    private String stateSha256;
    @Column(name = "collaboration_epoch", updatable = false)
    private Long collaborationEpoch;
    @Column(name = "collaboration_sequence", updatable = false)
    private Long collaborationSequence;

    public void describeSnapshot(String name, String actorName,
            dev.researchhub.document.application.DocumentSnapshotState.State state) {
        this.name=name; this.actorName=actorName;
        if (state!=null) { this.yjsState=state.bytes().clone(); this.stateSha256=state.sha256();
            this.collaborationEpoch=state.epoch(); this.collaborationSequence=state.sequence(); }
    }
    public String getName() { return name; }
    public String getActorName() { return actorName; }
    public String getStateSha256() { return stateSha256; }
    public Long getCollaborationEpoch() { return collaborationEpoch; }
    public Long getCollaborationSequence() { return collaborationSequence; }

    /** Required by JPA. Application code uses {@link #fromDomain(DocumentVersion)}. */
    protected DocumentVersionEntity() {
    }

    public static DocumentVersionEntity fromDomain(DocumentVersion version) {
        if (version.id() != null) {
            throw new IllegalArgumentException("a version is inserted once and never saved again");
        }
        DocumentVersionEntity entity = new DocumentVersionEntity();
        entity.documentId = version.documentId();
        entity.revision = version.revision();
        entity.contentFormat = version.contentFormat();
        entity.content = version.content().json();
        entity.reason = version.reason();
        entity.restoredFromVersionId = version.restoredFromVersionId();
        entity.createdBy = version.createdBy();
        entity.createdAt = version.createdAt();
        return entity;
    }

    public DocumentVersion toDomain() {
        return new DocumentVersion(id, documentId, revision, contentFormat, DocumentContent.ofStoredJson(content),
                reason, restoredFromVersionId, createdBy, createdAt);
    }

    public UUID getId() {
        return id;
    }

    public UUID getDocumentId() {
        return documentId;
    }

    public long getRevision() {
        return revision;
    }

    public DocumentContentFormat getContentFormat() {
        return contentFormat;
    }

    public String getContent() {
        return content;
    }

    public DocumentVersionReason getReason() {
        return reason;
    }

    public UUID getRestoredFromVersionId() {
        return restoredFromVersionId;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

}
