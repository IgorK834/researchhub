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

    /** Every filter, including the count, is evaluated within an authorized workspace. */
    @Query(value = """
            SELECT s.*
            FROM sources s WHERE s.workspace_id = :workspaceId
              AND (:query = '' OR strpos(lower(s.display_name), :query) > 0
                   OR strpos(lower(s.original_filename), :query) > 0
                   OR strpos(lower(coalesce(s.bibliography->>'title', '')), :query) > 0)
              AND (:type = '' OR s.source_type = :type)
              AND (:uploader = '' OR cast(s.uploaded_by AS text) = :uploader)
              AND (:status = '' OR s.status = :status)
              AND (:tag = '' OR s.tags @> jsonb_build_array(cast(:tag AS text)))
              AND (:collection = '' OR s.collections @> jsonb_build_array(cast(:collection AS text)))
            ORDER BY s.created_at DESC, s.id DESC
            """, countQuery = """
            SELECT count(*)
            FROM sources s WHERE s.workspace_id = :workspaceId
              AND (:query = '' OR strpos(lower(s.display_name), :query) > 0
                   OR strpos(lower(s.original_filename), :query) > 0
                   OR strpos(lower(coalesce(s.bibliography->>'title', '')), :query) > 0)
              AND (:type = '' OR s.source_type = :type)
              AND (:uploader = '' OR cast(s.uploaded_by AS text) = :uploader)
              AND (:status = '' OR s.status = :status)
              AND (:tag = '' OR s.tags @> jsonb_build_array(cast(:tag AS text)))
              AND (:collection = '' OR s.collections @> jsonb_build_array(cast(:collection AS text)))
            """, nativeQuery = true)
    org.springframework.data.domain.Page<SourceEntity> search(
            @Param("workspaceId") UUID workspaceId, @Param("query") String query, @Param("type") String type,
            @Param("uploader") String uploader, @Param("status") String status, @Param("tag") String tag,
            @Param("collection") String collection, org.springframework.data.domain.Pageable pageable);

    @Query(value = "SELECT DISTINCT label FROM sources s CROSS JOIN LATERAL jsonb_array_elements_text(s.tags) label WHERE s.workspace_id = :workspaceId ORDER BY label", nativeQuery = true)
    List<String> tags(@Param("workspaceId") UUID workspaceId);

    @Query(value = "SELECT DISTINCT label FROM sources s CROSS JOIN LATERAL jsonb_array_elements_text(s.collections) label WHERE s.workspace_id = :workspaceId ORDER BY label", nativeQuery = true)
    List<String> collections(@Param("workspaceId") UUID workspaceId);

    @Query(value = "SELECT DISTINCT uploaded_by FROM sources WHERE workspace_id = :workspaceId ORDER BY uploaded_by", nativeQuery = true)
    List<UUID> uploaders(@Param("workspaceId") UUID workspaceId);

    interface TypeCount {
        String getType();
        long getCount();
        long getReady();
    }

    @Query(value = "SELECT source_type AS type, count(*) AS count, count(*) FILTER (WHERE status = 'READY') AS ready FROM sources WHERE workspace_id = :workspaceId GROUP BY source_type", nativeQuery = true)
    List<TypeCount> typeCounts(@Param("workspaceId") UUID workspaceId);

}
