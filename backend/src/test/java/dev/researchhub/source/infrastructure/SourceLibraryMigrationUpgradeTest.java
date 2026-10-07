package dev.researchhub.source.infrastructure;

import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.source.SourceRowFixture;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import javax.sql.DataSource;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

@PostgresIntegrationTest
class SourceLibraryMigrationUpgradeTest {
    @Autowired DataSource dataSource;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void addsEmptyMetadataToExistingSourcesAndEnforcesBoundsWithoutChangingVersions() throws Exception {
        String schema = "library_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try {
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration").target("33").load().migrate();
            try (var connection = dataSource.getConnection()) {
                connection.setSchema(schema);
                var jdbc = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
                UUID user = UUID.randomUUID(), workspace = UUID.randomUUID(), source = UUID.randomUUID();
                jdbc.update("INSERT INTO users(id,email,normalized_email,password_hash,display_name,status,created_at,updated_at) VALUES (?, 'old@example.com','old@example.com','hash','Old','ACTIVE',now(),now())", user);
                jdbc.update("INSERT INTO workspaces(id,name,created_by,created_at,updated_at) VALUES (?, 'Old', ?,now(),now())", workspace, user);
                UUID version = SourceRowFixture.insertReadyText(jdbc, source, workspace, user, "Legacy paper");
                String before = jdbc.queryForObject("SELECT row_to_json(v)::text FROM source_versions v WHERE id = ?", String.class, version);
                Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                        .locations("classpath:db/migration").load().migrate();
                assertEquals(before, jdbc.queryForObject("SELECT row_to_json(v)::text FROM source_versions v WHERE id = ?", String.class, version));
                assertEquals("[]", jdbc.queryForObject("SELECT tags::text FROM sources WHERE id = ?", String.class, source));
                assertEquals("[]", jdbc.queryForObject("SELECT collections::text FROM sources WHERE id = ?", String.class, source));
                assertEquals("[]", jdbc.queryForObject("SELECT (bibliography->'authors')::text FROM sources WHERE id = ?", String.class, source));
                assertNull(jdbc.queryForObject("SELECT bibliography->>'title' FROM sources WHERE id = ?", String.class, source));
                assertEquals(version, jdbc.queryForObject("SELECT active_version_id FROM sources WHERE id = ?", UUID.class, source));
                for (String invalid : new String[]{"{}", "[1]", "[null]", "[\"\"]", "[\"UPPER\"]", "[\"repeat\",\"repeat\"]", "[\" spaced \"]"})
                    assertThrows(org.springframework.dao.DataAccessException.class,
                            () -> jdbc.update("UPDATE sources SET tags = ?::jsonb WHERE id = ?", invalid, source));
                assertThrows(org.springframework.dao.DataAccessException.class,
                        () -> jdbc.update("UPDATE sources SET bibliography = '{\"authors\":[]}'::jsonb WHERE id = ?", source));
                assertEquals(1, jdbc.update("UPDATE sources SET tags = '[\"review\"]'::jsonb, collections = '[\"papers\"]'::jsonb WHERE id = ?", source));
                connection.setSchema("public");
            }
        } finally {
            try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
                statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
        }
    }
}
