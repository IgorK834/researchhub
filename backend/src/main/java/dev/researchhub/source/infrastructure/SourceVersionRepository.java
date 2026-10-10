package dev.researchhub.source.infrastructure;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** All reads are scoped by workspace and stable source identity. */
public interface SourceVersionRepository extends Repository<SourceVersionEntity, UUID> {
    <S extends SourceVersionEntity> S saveAndFlush(S version);
    Optional<SourceVersionEntity> findByWorkspaceIdAndSourceIdAndId(UUID workspaceId, UUID sourceId, UUID id);
    Optional<SourceVersionEntity> findByWorkspaceIdAndId(UUID workspaceId,UUID id);
    boolean existsByWorkspaceIdAndId(UUID workspaceId, UUID id);
    List<SourceVersionEntity> findByWorkspaceIdAndSourceIdOrderByVersionNumberDesc(UUID workspaceId, UUID sourceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select version from SourceVersionEntity version where version.workspaceId=:workspaceId and version.sourceId=:sourceId and version.id=:id")
    Optional<SourceVersionEntity> findForUpdate(@Param("workspaceId") UUID workspaceId,
                                                @Param("sourceId") UUID sourceId,
                                                @Param("id") UUID id);
}
