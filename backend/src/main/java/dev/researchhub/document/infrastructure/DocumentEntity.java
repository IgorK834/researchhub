package dev.researchhub.document.infrastructure;

import dev.researchhub.document.domain.Document;
import dev.researchhub.document.domain.DocumentContent;
import dev.researchhub.document.domain.DocumentContentFormat;
import dev.researchhub.shared.validation.FieldLengths;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA mapping for the {@code documents} table created by {@code V6__create_documents.sql}.
 *
 * <p>Names are explicit, not derived, so a rename in Java cannot silently diverge from the migration. Flyway
 * owns the schema; Hibernate never creates or alters it (docs/development/persistence.md).
 *
 * <p>{@code workspaceId} and {@code createdBy} are plain {@link UUID} columns rather than mapped associations.
 * For {@code createdBy} that is a module-boundary requirement — {@code document} must not import
 * {@code user.infrastructure}. For {@code workspaceId} it is the same reason plus a practical one: the
 * authorization check needs the workspace id and nothing else, so mapping an association would drag a
 * workspace into the session on every document read.
 */
@Entity
@Table(name = "documents")
public class DocumentEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** The owning workspace. Never updatable: moving a document between workspaces would move its access. */
    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "title", nullable = false, length = FieldLengths.TITLE_MAX)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(name = "content_format", nullable = false, length = 32)
    private DocumentContentFormat contentFormat;

    /**
     * The document as JSON text, stored in a {@code jsonb} column.
     *
     * <p>Kept as a {@link String} rather than a mapped object graph: the backend does not interpret the
     * content, so parsing it on every read and re-serializing it on every write would be work in service of
     * nothing. {@code @JdbcTypeCode(SqlTypes.JSON)} is what makes the driver hand this to PostgreSQL as
     * {@code jsonb}, which is also what makes the database able to reject a non-object.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "content", nullable = false)
    private String content;

    /** Optimistic-concurrency token. Not a Hibernate {@code @Version}; see {@link Document}. */
    @Column(name = "revision", nullable = false)
    private long revision;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** When the document was archived, or null while it is active. Archiving never deletes the row. */
    @Column(name = "archived_at")
    private Instant archivedAt;

    /** Required by JPA. Application code uses {@link #fromDomain(Document)}. */
    protected DocumentEntity() {
    }

    private DocumentEntity(UUID id, UUID workspaceId, String title,
                           DocumentContentFormat contentFormat, String content, long revision,
                           UUID createdBy, Instant createdAt, Instant updatedAt, Instant archivedAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.title = title;
        this.contentFormat = contentFormat;
        this.content = content;
        this.revision = revision;
        this.createdBy = createdBy;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.archivedAt = archivedAt;
    }

    public static DocumentEntity fromDomain(Document document) {
        return new DocumentEntity(
                document.id(),
                document.workspaceId(),
                document.title(),
                document.contentFormat(),
                document.content().json(),
                document.revision(),
                document.createdBy(),
                document.createdAt(),
                document.updatedAt(),
                document.archivedAt());
    }

    public Document toDomain() {
        return new Document(id, workspaceId, title, DocumentContent.ofStoredJson(content),
                contentFormat, revision, createdBy, createdAt, updatedAt, archivedAt);
    }

    public UUID getId() {
        return id;
    }

    public UUID getWorkspaceId() {
        return workspaceId;
    }

    public String getTitle() {
        return title;
    }

    public DocumentContentFormat getContentFormat() {
        return contentFormat;
    }

    public String getContent() {
        return content;
    }

    public long getRevision() {
        return revision;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public Instant getArchivedAt() {
        return archivedAt;
    }

}
