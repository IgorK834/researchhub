package dev.researchhub.source.infrastructure;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link SourceEntity}.
 *
 * <p>The bare {@link Repository} marker, for the same reason as {@code DocumentRepository}: no inherited
 * {@code findById} that ignores the workspace. <strong>Every read takes the workspace id</strong>, so a source id
 * tried against another workspace matches no row. And there is no lookup by storage key at all — a key is never a
 * way in.
 */
public interface SourceRepository extends Repository<SourceEntity, UUID> {

    <S extends SourceEntity> S saveAndFlush(S source);

    /** One source, only if it belongs to this workspace. */
    Optional<SourceEntity> findByWorkspaceIdAndId(UUID workspaceId, UUID id);

    /** State-listener read: serializes job callbacks that update a source lifecycle. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select source from SourceEntity source where source.workspaceId = :workspaceId and source.id = :id")
    Optional<SourceEntity> findByWorkspaceIdAndIdForUpdate(@Param("workspaceId") UUID workspaceId,
                                                           @Param("id") UUID id);

    /** The workspace's sources, newest first. */
    List<SourceEntity> findByWorkspaceIdOrderByCreatedAtDesc(UUID workspaceId);

}
