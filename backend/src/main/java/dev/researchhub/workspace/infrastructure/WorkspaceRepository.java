package dev.researchhub.workspace.infrastructure;

import org.springframework.data.repository.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link WorkspaceEntity}. Found by the JPA scan in
 * {@code dev.researchhub.shared.infrastructure.persistence.JpaPersistenceConfiguration}, which is
 * active on the {@code local} profile only.
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

    /**
     * The workspaces with these ids, newest first.
     *
     * <p>The ids come from the caller's own memberships, which is what scopes
     * {@code GET /api/workspaces} to the current user. An empty collection returns an empty list.
     */
    List<WorkspaceEntity> findByIdInOrderByCreatedAtDesc(Collection<UUID> ids);

}
