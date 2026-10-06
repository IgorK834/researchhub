package dev.researchhub.document.infrastructure;

import dev.researchhub.document.domain.DocumentVersionReason;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link DocumentVersionEntity}.
 *
 * <p>Insert and read, nothing else. There is no update and no delete method, because history is immutable, and
 * the table would refuse them anyway.
 *
 * <p>Every read takes the document id. The caller finds the document through its workspace first, so a version id
 * from another document — or another workspace — matches no row, exactly like {@link DocumentRepository}.
 */
public interface DocumentVersionRepository extends Repository<DocumentVersionEntity, UUID> {

    <S extends DocumentVersionEntity> S saveAndFlush(S version);

    /** One snapshot, with its content, only if it belongs to this document. */
    Optional<DocumentVersionEntity> findByDocumentIdAndId(UUID documentId, UUID id);

    /**
     * The document's history, newest revision first, without content.
     *
     * <p>A projection rather than the entity, so listing twenty snapshots does not read twenty copies of the
     * document. Served by the {@code uq_document_versions_document_revision} index.
     */
    @Query("SELECT v FROM DocumentVersionEntity v WHERE v.documentId=:documentId ORDER BY v.revision DESC,v.createdAt DESC,v.id DESC")
    List<VersionSummaryRow> findByDocumentIdOrderByRevisionDesc(@Param("documentId") UUID documentId);

    /** When the newest snapshot was taken, or empty when the document has none. */
    @Query("SELECT max(v.createdAt) FROM DocumentVersionEntity v WHERE v.documentId = :documentId")
    Optional<Instant> findNewestCreatedAt(@Param("documentId") UUID documentId);

    /** The columns a history list needs. */
    interface VersionSummaryRow {

        UUID getId();

        long getRevision();

        DocumentVersionReason getReason();

        UUID getRestoredFromVersionId();

        UUID getCreatedBy();

        Instant getCreatedAt();
        String getName();
        String getActorName();
        String getStateSha256();
        Long getCollaborationEpoch();
        Long getCollaborationSequence();

    }

}
