package dev.researchhub.workspace.infrastructure;

import org.springframework.data.repository.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link WorkspaceEntity}. Found by Spring Boot's repository auto-configuration
 * in every runtime with JPA persistence.
 *
 * <p>Extends the bare {@link Repository} marker rather than {@code JpaRepository}, and that is the
 * point: {@code JpaRepository} would inherit {@code findAll()}, a method that returns every workspace
 * in the database across all tenants. A workspace is a security boundary, so the only reads offered
 * here are by id and by an explicit set of ids the caller has already been shown to belong to. There
 * is nothing to accidentally call.
 */
public interface WorkspaceRepository extends Repository<WorkspaceEntity, UUID> {

    <S extends WorkspaceEntity> S saveAndFlush(S workspace);

    Optional<WorkspaceEntity> findById(UUID id);

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select w from WorkspaceEntity w where w.id = :id")
    Optional<WorkspaceEntity> findByIdForUpdate(UUID id);

    /**
     * The active workspaces with these ids, newest first. Archived ones are left out.
     *
     * <p>The ids come from the caller's own memberships, which is what scopes
     * {@code GET /api/workspaces} to the current user. An empty collection returns an empty list.
     *
     * <p>{@code archived_at IS NULL} is part of the query rather than a filter applied in Java
     * afterwards. Both would produce the same list today, but only this one keeps the database from
     * returning rows the caller will not be shown — and it cannot be defeated by a later change that
     * forgets the filter, because there is no unfiltered variant of this method to call.
     */
    List<WorkspaceEntity> findByIdInAndArchivedAtIsNullOrderByCreatedAtDesc(Collection<UUID> ids);

}
