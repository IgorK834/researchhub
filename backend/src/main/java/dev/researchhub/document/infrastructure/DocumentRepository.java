package dev.researchhub.document.infrastructure;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link DocumentEntity}. Found by the JPA scan in
 * {@code dev.researchhub.shared.infrastructure.persistence.JpaPersistenceConfiguration}, which is active on
 * the {@code local} profile only.
 *
 * <p>Extends the bare {@link Repository} marker rather than {@code JpaRepository}, and that is the point:
 * {@code JpaRepository} would inherit {@code findAll()} and — more dangerously here — {@code findById(id)}, a
 * lookup that ignores the workspace. A document id is the kind of value that ends up in a URL, gets pasted
 * into a chat, and is tried against another workspace. There is no method here that could answer such a
 * request, because <strong>every read takes the workspace id</strong>.
 *
 * <p>That is what makes cross-workspace substitution a 404 rather than a bug waiting for a forgotten
 * {@code if}: asking for workspace A's document with workspace B in the path is a query that matches no row.
 */
public interface DocumentRepository extends Repository<DocumentEntity, UUID> {

    <S extends DocumentEntity> S saveAndFlush(S document);

    /**
     * One document, but only if it belongs to this workspace.
     *
     * <p>Both halves of the key are required. Empty means "no such document here", whether the id does not
     * exist at all or belongs to somebody else's workspace — the caller cannot tell, which is the intent.
     */
    Optional<DocumentEntity> findByWorkspaceIdAndId(UUID workspaceId, UUID id);

    /**
     * As {@link #findByWorkspaceIdAndId}, holding a row lock until the transaction ends.
     *
     * <p>For writes that compare the caller's revision with the stored one. Without the lock, two saves carrying
     * the same revision could both read it, both pass the comparison, and the second would overwrite the first —
     * the lost update the revision exists to prevent. With it, the second waits, then reads the revision the
     * first wrote, and is refused. Autosave makes that timing ordinary rather than rare.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<DocumentEntity> findForUpdateByWorkspaceIdAndId(UUID workspaceId, UUID id);

    /**
     * The active documents in one workspace, most recently updated first.
     *
     * <p>Archived documents are excluded by the query rather than filtered afterwards, so a row the caller
     * will not be shown never leaves the database. They remain reachable by id, because archiving hides a
     * document from the list without destroying its text.
     */
    List<DocumentEntity> findByWorkspaceIdAndArchivedAtIsNullOrderByUpdatedAtDesc(UUID workspaceId);

}
