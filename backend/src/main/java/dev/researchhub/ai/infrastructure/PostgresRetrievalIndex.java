package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.*;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

/** Exact cosine and full-text candidates are selected within the mandatory workspace scope. */
@Repository
@Profile("local")
public class PostgresRetrievalIndex implements RetrievalIndex {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public PostgresRetrievalIndex(JdbcTemplate jdbc, ObjectMapper mapper) { this.jdbc = jdbc; this.mapper = mapper; }

    @Override @Transactional
    public void upsert(UUID jobId, RetrievalChunkSet set, EmbeddingBatch embeddings) {
        embeddings.requireCount(set.chunks().size());
        var model = embeddings.metadata();
        // Scope is checked before a destructive replacement, even for internal callers.
        if (set.workspaceId() == null || set.sourceId() == null || set.chunks().stream().anyMatch(c ->
                !set.workspaceId().equals(c.workspaceId()) || !set.sourceId().equals(c.sourceId()) || !set.processingVersion().equals(c.processingVersion())))
            throw new IllegalArgumentException("Invalid index scope");
        if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM source_retrieval_sets WHERE workspace_id=? AND source_id=? AND job_id=?)",
                Boolean.class, set.workspaceId(), set.sourceId(), jobId))) throw new IllegalStateException("Index job differs from the current chunk set");
        jdbc.update("INSERT INTO retrieval_embedding_models(index_id,provider,model_name,model_version,dimension) VALUES (?,?,?,?,?) ON CONFLICT(index_id) DO NOTHING",
                model.indexId(), model.provider(), model.name(), model.version(), model.dimension());
        delete(set.workspaceId(), set.sourceId());
        var rows = new ArrayList<Object[]>();
        for (int i = 0; i < set.chunks().size(); i++) {
            var chunk = set.chunks().get(i);
            rows.add(new Object[]{chunk.chunkId(), chunk.workspaceId(), chunk.sourceId(), chunk.processingVersion(),
                model.indexId(), model.dimension(), vector(embeddings.vectors().get(i)), chunk.content()});
        }
        int[] counts = jdbc.batchUpdate("""
            INSERT INTO source_chunk_embeddings(chunk_id,workspace_id,source_id,processing_version,index_id,dimension,embedding,content)
            VALUES (?,?,?,?,?,?,?::public.vector,?)
            """, rows);
        if (counts.length != rows.size() || Arrays.stream(counts).anyMatch(n -> n != 1 && n != java.sql.Statement.SUCCESS_NO_INFO))
            throw new IllegalStateException("Index projection was not persisted");
    }
    @Override @Transactional
    public void delete(UUID workspaceId, UUID sourceId) {
        Objects.requireNonNull(workspaceId); Objects.requireNonNull(sourceId);
        jdbc.update("DELETE FROM source_chunk_embeddings WHERE workspace_id=? AND source_id=?", workspaceId, sourceId);
    }
    @Override
    public boolean existsForJob(UUID workspaceId, UUID sourceId, UUID jobId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM source_retrieval_sets r JOIN source_extractions e
                ON e.source_id=r.source_id AND e.workspace_id=r.workspace_id AND e.job_id=r.job_id
                WHERE r.workspace_id=? AND r.source_id=? AND r.job_id=?
                AND r.chunk_count=(SELECT count(*) FROM source_chunk_embeddings v WHERE v.workspace_id=r.workspace_id
                    AND v.source_id=r.source_id AND v.processing_version=r.processing_version))
            """, Boolean.class, workspaceId, sourceId, jobId));
    }
    @Override @Transactional(readOnly = true)
    public boolean hasSearchableChunks(UUID workspaceId, List<UUID> sourceIds) {
        Objects.requireNonNull(workspaceId);
        if (sourceIds != null && sourceIds.size() > 100) throw new IllegalArgumentException("Invalid source limits");
        if (sourceIds != null && sourceIds.isEmpty()) return false;
        String filter = sourceIds == null ? "" : " AND v.source_id IN (" + String.join(",", Collections.nCopies(sourceIds.size(), "?")) + ")";
        var args = new ArrayList<Object>(); args.add(workspaceId);
        if (sourceIds != null) args.addAll(sourceIds);
        // Same READY/current extraction publication boundary as search, before any remote embedding.
        return Boolean.TRUE.equals(jdbc.queryForObject("""
            SELECT EXISTS (SELECT 1 FROM source_chunk_embeddings v
                JOIN sources s ON s.id=v.source_id AND s.workspace_id=v.workspace_id
                JOIN source_retrieval_chunks c ON c.chunk_id=v.chunk_id AND c.workspace_id=v.workspace_id AND c.source_id=v.source_id
                JOIN source_retrieval_sets r ON r.source_id=v.source_id AND r.workspace_id=v.workspace_id AND r.processing_version=v.processing_version
                JOIN source_extractions e ON e.source_id=r.source_id AND e.workspace_id=r.workspace_id AND e.job_id=r.job_id
                WHERE v.workspace_id=? AND s.status='READY' AND c.source_version_id=s.active_version_id
            """ + filter + ")",Boolean.class,args.toArray()));
    }
    @Override @Transactional(readOnly = true)
    public List<RetrievalHit> search(String query, UUID workspaceId, List<UUID> sourceIds, int topK, EmbeddingBatch embedding) {
        Objects.requireNonNull(workspaceId);
        if (query == null || query.isBlank() || topK < 1 || topK > 50 || (sourceIds != null && sourceIds.size() > 100))
            throw new IllegalArgumentException("Invalid search scope or limits");
        embedding.requireCount(1);
        if (sourceIds != null && sourceIds.isEmpty()) return List.of();
        String filter = sourceIds == null ? "" : " AND v.source_id IN (" + String.join(",", Collections.nCopies(sourceIds.size(), "?")) + ")";
        var args = new ArrayList<Object>(List.of(query, vector(embedding.vectors().getFirst()), workspaceId, embedding.metadata().indexId()));
        if (sourceIds != null) args.addAll(sourceIds);
        args.add(topK * 10); args.add(topK * 10); args.add(topK);
        // MATERIALIZED prevents dimension-sensitive distance calculation from escaping the namespace predicate.
        String sql = """
            WITH parameters AS (SELECT plainto_tsquery('simple', ?) AS terms, ?::public.vector AS vector),
            scoped AS MATERIALIZED (
                SELECT v.*, c.chunk_index,c.source_version_id,c.page_start,c.page_end,c.section_title,c.content_hash,c.spans
                FROM source_chunk_embeddings v JOIN sources s ON s.id=v.source_id AND s.workspace_id=v.workspace_id
                JOIN source_retrieval_chunks c ON c.chunk_id=v.chunk_id AND c.workspace_id=v.workspace_id AND c.source_id=v.source_id
                JOIN source_retrieval_sets r ON r.source_id=v.source_id AND r.workspace_id=v.workspace_id AND r.processing_version=v.processing_version
                JOIN source_extractions e ON e.source_id=r.source_id AND e.workspace_id=r.workspace_id AND e.job_id=r.job_id
                WHERE v.workspace_id=? AND v.index_id=? AND s.status='READY'
                  AND c.source_version_id=s.active_version_id
            """ + filter + """
            ),
            scored AS MATERIALIZED (SELECT s.*, 1-(s.embedding OPERATOR(public.<=>) p.vector) AS similarity,
                ts_rank_cd(s.lexical,p.terms)::double precision AS text_score, s.lexical @@ p.terms AS text_match FROM scoped s CROSS JOIN parameters p),
            vector_candidates AS (SELECT chunk_id,row_number() OVER (ORDER BY similarity DESC,chunk_id) AS rank
                FROM scored ORDER BY similarity DESC,chunk_id LIMIT ?),
            lexical_candidates AS (SELECT chunk_id,row_number() OVER (ORDER BY text_score DESC,chunk_id) AS rank
                FROM scored WHERE text_match ORDER BY text_score DESC,chunk_id LIMIT ?),
            fused AS (SELECT coalesce(v.chunk_id,l.chunk_id) AS chunk_id,
                coalesce(1.0/(60+v.rank),0)+coalesce(1.0/(60+l.rank),0) AS score
                FROM vector_candidates v FULL JOIN lexical_candidates l ON l.chunk_id=v.chunk_id)
            SELECT s.*,f.score FROM fused f JOIN scored s ON s.chunk_id=f.chunk_id ORDER BY f.score DESC,s.chunk_id LIMIT ?
            """;
        return jdbc.query(sql, (row, _i) -> new RetrievalHit(new RetrievalChunk(row.getString("chunk_id"),
            row.getObject("source_id",UUID.class), row.getObject("workspace_id",UUID.class), row.getObject("source_version_id",UUID.class),
            row.getInt("chunk_index"),row.getString("content"),row.getObject("page_start",Integer.class),row.getObject("page_end",Integer.class),
            row.getString("section_title"),row.getString("content_hash"),row.getString("processing_version"),
            List.of(mapper.readValue(row.getString("spans"),SourceSpan[].class))),row.getDouble("score"),row.getDouble("similarity"),
            row.getDouble("text_score"),embedding.metadata()), args.toArray());
    }
    private static String vector(List<Double> vector) { return vector.toString(); }
}
