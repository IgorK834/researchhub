package dev.researchhub.shared.infrastructure.persistence;

import dev.researchhub.ai.application.RetrievalChunkSet;
import dev.researchhub.processing.infrastructure.WorkerJobResult;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RH-130: V19 against real data written by V18. Existing sources become version 1 without their blobs moving, and
 * everything an old analysis needs to be reproduced after its source is replaced is archived by the migration itself.
 */
@PostgresIntegrationTest
class SourceVersionMigrationUpgradeTest {
    @Autowired
    DataSource dataSource;
    @Autowired
    ObjectMapper mapper;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void legacySourcesBecomeVersionOneAndOldAnalysesStayReproducible() throws Exception {
        String schema = "versions_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration").target("18").load().migrate();
            try (var connection = dataSource.getConnection()) {
                var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
                connection.setSchema(schema);

                var result = mapper.readValue(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-success.json")),
                        WorkerJobResult.class);
                var extraction = result.extraction();
                var retrieval = result.retrieval();
                UUID workspace = result.workspaceId(), source = result.sourceId(), job = result.jobId();
                UUID user = UUID.randomUUID(), analysis = UUID.randomUUID();
                String storageKey = "sources/" + UUID.randomUUID();
                String hash = extraction.extractionMetadata().contentSha256();
                jdbc.update("INSERT INTO users(id,email,normalized_email,password_hash,display_name,status,created_at,updated_at) VALUES (?, 'old@example.com','old@example.com','hash','Old','ACTIVE',now(),now())", user);
                jdbc.update("INSERT INTO workspaces(id,name,created_by,created_at,updated_at) VALUES (?, 'Old', ?,now(),now())", workspace, user);
                jdbc.update("INSERT INTO sources(id,workspace_id,original_filename,display_name,media_type,source_type,size_bytes,storage_key,content_sha256,status,uploaded_by,created_at,updated_at) VALUES (?,?,'lecture.pdf','Lecture','application/pdf','PDF',2048,?,?,'READY',?,now(),now())", source, workspace, storageKey, hash, user);
                jdbc.update("INSERT INTO processing_jobs(id,workspace_id,job_type,resource_type,resource_id,status,attempt_count,created_at,started_at,finished_at) VALUES (?,?,'SOURCE_INGEST','SOURCE',?,'SUCCEEDED',1,now(),now(),now())", job, workspace, source);
                jdbc.update("INSERT INTO source_extractions(source_id,workspace_id,job_id,parser_version,content_sha256,payload,created_at,processing_version,schema_version) VALUES (?,?,?,?,?,?::jsonb,now(),?,'4.0')",
                        source, workspace, job, extraction.parserVersion(), hash, mapper.writeValueAsString(extraction), extraction.processingVersion());
                jdbc.update("INSERT INTO source_extraction_runs(job_id,source_id,workspace_id,parser_version,processing_version,schema_version,persisted_at) VALUES (?,?,?,?,?,'4.0',now())",
                        job, source, workspace, extraction.parserVersion(), extraction.processingVersion());
                jdbc.update("INSERT INTO source_retrieval_sets(source_id,workspace_id,job_id,processing_version,chunk_count,metadata,created_at) VALUES (?,?,?,?,?,?::jsonb,now())",
                        source, workspace, job, retrieval.processingVersion(), retrieval.chunks().size(),
                        mapper.writeValueAsString(retrieval.withChunks(List.of())));
                for (var chunk : retrieval.chunks()) {
                    jdbc.update("INSERT INTO source_retrieval_chunks(chunk_id,source_id,workspace_id,source_version_id,chunk_index,page_start,page_end,section_title,content_hash,processing_version,spans) VALUES (?,?,?,NULL,?,?,?,?,?,?,?::jsonb)",
                            chunk.chunkId(), source, workspace, chunk.chunkIndex(), chunk.pageStart(), chunk.pageEnd(),
                            chunk.sectionTitle(), chunk.contentHash(), chunk.processingVersion(), mapper.writeValueAsString(chunk.spans()));
                }
                jdbc.update("INSERT INTO ai_source_analyses(id,workspace_id,created_by,kind,payload,created_at) VALUES (?,?,?,'COMPARISON',?::jsonb,now())",
                        analysis, workspace, user, mapper.writeValueAsString(Map.of("sources", List.of(Map.of("id", source.toString(), "title", "Lecture")))));

                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                        .locations("classpath:db/migration").load().migrate();

                // The source keeps its identity and bytes; version 1 mirrors them and is the active version.
                var version = jdbc.queryForMap("SELECT * FROM source_versions WHERE source_id = ?", source);
                UUID versionId = (UUID) version.get("id");
                assertEquals(1, version.get("version_number"));
                assertEquals(storageKey, version.get("storage_key"));
                assertEquals(hash, version.get("content_sha256"));
                assertEquals("READY", version.get("status"));
                assertEquals("lecture.pdf", version.get("original_filename"));
                var active = jdbc.queryForMap("SELECT active_version_id, active_version_number, storage_key FROM sources WHERE id = ?", source);
                assertEquals(versionId, active.get("active_version_id"));
                assertEquals(1, active.get("active_version_number"));
                assertEquals(storageKey, active.get("storage_key"));

                // Its derived data now names the version it came from.
                assertEquals(versionId, jdbc.queryForObject("SELECT source_version_id FROM processing_job_source_versions WHERE job_id = ?", UUID.class, job));
                assertEquals(versionId, jdbc.queryForObject("SELECT source_version_id FROM source_extraction_runs WHERE job_id = ?", UUID.class, job));
                assertEquals(versionId, jdbc.queryForObject("SELECT source_version_id FROM source_version_extractions WHERE source_id = ?", UUID.class, source));
                assertEquals(retrieval.chunks().size(), jdbc.queryForObject("SELECT count(*) FROM source_retrieval_chunks WHERE source_version_id = ?", Integer.class, versionId));
                assertEquals(versionId, jdbc.queryForObject("SELECT source_version_id FROM ai_source_analysis_sources WHERE analysis_id = ?", UUID.class, analysis));

                // The archived retrieval snapshot is exactly the set the application validates, text included.
                String archived = jdbc.queryForObject("SELECT payload::text FROM source_version_retrieval_sets WHERE source_version_id = ?", String.class, versionId);
                var snapshot = mapper.readValue(archived, RetrievalChunkSet.class);
                assertNotNull(snapshot);
                assertTrue(snapshot.chunks().size() > 0);
                assertEquals(retrieval.withSourceVersion(versionId), snapshot);
                snapshot.validate(workspace, source, extraction);

                // Version rows are immutable and cannot be repointed.
                assertThrows(Exception.class, () -> jdbc.update("UPDATE source_versions SET storage_key = ? WHERE id = ?", "sources/" + UUID.randomUUID(), versionId));
                assertThrows(Exception.class, () -> jdbc.update("DELETE FROM source_versions WHERE id = ?", versionId));
                jdbc.execute("RESET search_path");
            }
        } finally {
            new JdbcTemplate(dataSource).execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
