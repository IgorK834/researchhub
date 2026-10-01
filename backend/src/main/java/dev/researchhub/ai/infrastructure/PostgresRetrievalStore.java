package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import dev.researchhub.processing.application.SourceExtraction;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Repository
@Profile("local")
public class PostgresRetrievalStore implements RetrievalStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public PostgresRetrievalStore(JdbcTemplate jdbc, ObjectMapper mapper) { this.jdbc = jdbc; this.mapper = mapper; }
    @Override
    @Transactional
    public void save(UUID jobId, RetrievalChunkSet set, Instant now) {
        if (set.sourceVersionId() == null) throw new IllegalArgumentException("Source version is required");
        jdbc.update("DELETE FROM source_retrieval_chunks WHERE source_id=? AND workspace_id=?", set.sourceId(), set.workspaceId());
        int saved = jdbc.update("""
                INSERT INTO source_retrieval_sets(source_id, workspace_id, job_id, processing_version, chunk_count, metadata, created_at)
                VALUES (?,?,?,?,?,?::jsonb,?) ON CONFLICT(source_id) DO UPDATE SET job_id=EXCLUDED.job_id,
                    processing_version=EXCLUDED.processing_version, chunk_count=EXCLUDED.chunk_count, metadata=EXCLUDED.metadata, created_at=EXCLUDED.created_at
                WHERE source_retrieval_sets.workspace_id=EXCLUDED.workspace_id
                """, set.sourceId(), set.workspaceId(), jobId, set.processingVersion(), set.chunks().size(), mapper.writeValueAsString(set.withChunks(List.of())), Timestamp.from(now));
        if (saved != 1) throw new IllegalStateException("Retrieval set was not persisted");
        int[] counts = jdbc.batchUpdate("""
                INSERT INTO source_retrieval_chunks(chunk_id,source_id,workspace_id,source_version_id,chunk_index,
                    page_start,page_end,section_title,content_hash,processing_version,spans) VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb)
                """, set.chunks().stream().map(chunk -> new Object[]{chunk.chunkId(), chunk.sourceId(), chunk.workspaceId(), chunk.sourceVersionId(),
                chunk.chunkIndex(), chunk.pageStart(), chunk.pageEnd(), chunk.sectionTitle(), chunk.contentHash(), chunk.processingVersion(), mapper.writeValueAsString(chunk.spans())}).toList());
        if (counts.length != set.chunks().size() || java.util.Arrays.stream(counts).anyMatch(count -> count != 1 && count != java.sql.Statement.SUCCESS_NO_INFO)) {
            throw new IllegalStateException("Retrieval chunks were not persisted");
        }
        int archived = jdbc.update("""
                INSERT INTO source_version_retrieval_sets(source_version_id,source_id,workspace_id,job_id,
                    processing_version,payload,created_at) VALUES (?,?,?,?,?,?::jsonb,?)
                ON CONFLICT(source_version_id) DO UPDATE SET job_id=EXCLUDED.job_id,
                    processing_version=EXCLUDED.processing_version,payload=EXCLUDED.payload,created_at=EXCLUDED.created_at
                WHERE source_version_retrieval_sets.source_id=EXCLUDED.source_id
                  AND source_version_retrieval_sets.workspace_id=EXCLUDED.workspace_id
                """, set.sourceVersionId(), set.sourceId(), set.workspaceId(), jobId, set.processingVersion(),
                mapper.writeValueAsString(set), Timestamp.from(now));
        if (archived != 1) throw new IllegalStateException("Versioned retrieval set was not persisted");
        int recorded = jdbc.update("UPDATE source_extraction_runs SET retrieval_processing_version=?, chunking_config=?::jsonb WHERE job_id=?",
                set.processingVersion(), mapper.writeValueAsString(set.config()), jobId);
        if (recorded != 1) throw new IllegalStateException("Retrieval processing version was not recorded");
    }
    @Override
    public boolean existsForJob(UUID workspaceId, UUID sourceId, UUID jobId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM source_retrieval_sets r JOIN source_extractions e
                    ON e.source_id=r.source_id AND e.job_id=r.job_id AND e.workspace_id=r.workspace_id
                    WHERE r.workspace_id=? AND r.source_id=? AND r.job_id=?
                    AND r.chunk_count=(SELECT count(*) FROM source_retrieval_chunks c WHERE c.source_id=r.source_id AND c.workspace_id=r.workspace_id))
                """, Boolean.class, workspaceId, sourceId, jobId));
    }
    @Override
    public Optional<RetrievalChunkSet> find(UUID workspaceId, UUID sourceId, SourceExtraction extraction) {
        var sets = jdbc.query("""
                SELECT r.metadata::text FROM source_retrieval_sets r JOIN source_extractions e
                ON e.source_id=r.source_id AND e.workspace_id=r.workspace_id AND e.job_id=r.job_id
                WHERE r.workspace_id=? AND r.source_id=?
                """, (row, _i) -> mapper.readValue(row.getString(1), RetrievalChunkSet.class), workspaceId, sourceId);
        if (sets.isEmpty()) return Optional.empty();
        var units = new HashMap<String, SourceExtraction.ExtractedChunk>();
        extraction.chunks().forEach(unit -> units.put(unit.chunkId(), unit));
        var chunks = jdbc.query("""
                SELECT chunk_id,source_id,workspace_id,source_version_id,chunk_index,page_start,page_end,
                    section_title,content_hash,processing_version,spans::text FROM source_retrieval_chunks
                WHERE workspace_id=? AND source_id=? ORDER BY chunk_index
                """, (row, _i) -> {
            var spans = List.of(mapper.readValue(row.getString(11), SourceSpan[].class));
            return new RetrievalChunk(row.getString(1), row.getObject(2, UUID.class), row.getObject(3, UUID.class), row.getObject(4, UUID.class),
                    row.getInt(5), RetrievalChunkSet.content(spans, units), row.getObject(6, Integer.class), row.getObject(7, Integer.class),
                    row.getString(8), row.getString(9), row.getString(10), spans);
        }, workspaceId, sourceId);
        var result = sets.getFirst().withChunks(chunks);
        result.validate(workspaceId, sourceId, extraction);
        return Optional.of(result);
    }
    @Override
    public Optional<RetrievalChunkSet> findVersion(UUID workspaceId, UUID sourceId, UUID sourceVersionId) {
        return jdbc.query("""
                SELECT payload::text FROM source_version_retrieval_sets
                WHERE workspace_id=? AND source_id=? AND source_version_id=?
                """, (row, _index) -> mapper.readValue(row.getString(1), RetrievalChunkSet.class),
                workspaceId, sourceId, sourceVersionId).stream().findFirst();
    }
}
