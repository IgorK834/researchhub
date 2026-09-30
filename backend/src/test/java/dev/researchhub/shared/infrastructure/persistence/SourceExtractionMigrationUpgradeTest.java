package dev.researchhub.shared.infrastructure.persistence;

import dev.researchhub.processing.application.SourceExtraction;
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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Exercises V12 against real stored v2 data, separately from fresh-schema checks. */
@PostgresIntegrationTest
class SourceExtractionMigrationUpgradeTest {
    @Autowired DataSource dataSource;
    @Autowired ObjectMapper mapper;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void upgradesLegacyPayloadsWithoutInventingRowsOrCopyingText() throws Exception {
        String schema = "upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration").target("11").load().migrate();
            try (var connection = dataSource.getConnection()) {
                var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
                connection.setSchema(schema);
                UUID user = UUID.randomUUID(), workspace = UUID.randomUUID();
                jdbc.update("INSERT INTO users(id,email,normalized_email,password_hash,display_name,status,created_at,updated_at) VALUES (?, 'old@example.com','old@example.com','hash','Old','ACTIVE',now(),now())", user);
                jdbc.update("INSERT INTO workspaces(id,name,created_by,created_at,updated_at) VALUES (?, 'Old', ?,now(),now())", workspace, user);
                for (String filename : new String[]{"source-ingest-result-success.json", "source-ingest-result-workbook.json"}) {
                    var old = mapper.readTree(Files.readString(Path.of("../contracts/processing/v2", filename)));
                    var payload = mapper.createObjectNode();
                    for (String field : new String[]{"parserVersion", "extractionMetadata", "structure", "chunks", "workbook", "warnings"}) payload.set(field, old.get(field));
                    UUID source = UUID.randomUUID(), job = UUID.randomUUID();
                    for (var chunk : payload.get("chunks")) ((tools.jackson.databind.node.ObjectNode) chunk).put("sourceId", source.toString());
                    String hash = old.get("extractionMetadata").get("contentSha256").asString();
                    String type = old.get("workbook").isNull() ? "PDF" : "XLSX";
                    String media = type.equals("PDF") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                    jdbc.update("INSERT INTO sources(id,workspace_id,original_filename,display_name,media_type,source_type,size_bytes,storage_key,content_sha256,status,uploaded_by,created_at,updated_at) VALUES (?,?,'old','old',?,?,1,?,?,'READY',?,now(),now())", source, workspace, media, type, "sources/" + UUID.randomUUID(), hash, user);
                    jdbc.update("INSERT INTO processing_jobs(id,workspace_id,job_type,resource_type,resource_id,status,attempt_count,created_at,started_at,finished_at) VALUES (?,?,'SOURCE_INGEST','SOURCE',?,'SUCCEEDED',1,now(),now(),now())", job, workspace, source);
                    jdbc.update("INSERT INTO source_extractions(source_id,workspace_id,job_id,parser_version,content_sha256,payload,created_at) VALUES (?,?,?,?,?,?::jsonb,now())", source, workspace, job, old.get("parserVersion").asString(), hash, mapper.writeValueAsString(payload));
                }
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                        .locations("classpath:db/migration").load().migrate();
                assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM source_extractions", Integer.class));
                assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM source_extraction_runs WHERE processing_version='source-ingest-2' AND schema_version='2.0' AND payload_sha256 IS NULL", Integer.class));
                for (String json : jdbc.queryForList("SELECT payload::text FROM source_extractions", String.class)) {
                    var extraction = mapper.readValue(json, SourceExtraction.class);
                    extraction.validate(extraction.chunks().getFirst().sourceId());
                    assertEquals("source-ingest-2", extraction.processingVersion());
                    if (extraction.workbook() != null) {
                        assertEquals(50, extraction.workbook().previewRowLimit());
                        extraction.workbook().sheets().forEach(sheet -> assertTrue(sheet.previewRows().isEmpty()));
                    }
                    assertFalse(extraction.chunks().isEmpty());
                }
                jdbc.execute("RESET search_path");
            }
        } finally {
            new JdbcTemplate(dataSource).execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
