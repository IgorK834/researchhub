package dev.researchhub.shared.infrastructure.persistence;

import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;

@PostgresIntegrationTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class FlywayMigrationIntegrationTest {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    @Order(1)
    void appliesClasspathMigrationsOnAFreshDatabase() {
        String database = jdbcTemplate.queryForObject("SELECT current_database()", String.class);
        assertEquals("test", database,
                "The test must use the Testcontainers database, not the Compose database researchhub");

        Integer baselineRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '1'",
                Integer.class);
        assertEquals(1, baselineRows, "Flyway should record the baseline migration from db/migration");

        Integer appliedVersions = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true",
                Integer.class);
        assertEquals(1, appliedVersions, "Only the immutable baseline migration should be applied");
    }

    @Test
    @Order(2)
    void writesDoNotLeakIntoTheNextTest() {
        jdbcTemplate.execute("CREATE TABLE isolation_probe (id int)");
    }

    @Test
    @Order(3)
    void previousWriteWasRolledBack() {
        Integer tables = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_name = 'isolation_probe'",
                Integer.class);
        assertEquals(0, tables,
                "A table created in an earlier test must disappear when that test's transaction rolls back");
    }

}
