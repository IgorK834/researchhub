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

        Integer usersMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '2'",
                Integer.class);
        assertEquals(1, usersMigrationRows, "Flyway should record V2__create_users.sql");

        Integer workspacesMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '3'",
                Integer.class);
        assertEquals(1, workspacesMigrationRows, "Flyway should record V3__create_workspaces.sql");

        Integer workspaceMembersMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '4'",
                Integer.class);
        assertEquals(1, workspaceMembersMigrationRows,
                "Flyway should record V4__create_workspace_members.sql");

        Integer appliedVersions = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true",
                Integer.class);
        assertEquals(4, appliedVersions,
                "A fresh database should have exactly versions 1 through 4 applied");
    }

    @Test
    @Order(1)
    void createsTheUsersTableWithUniquenessOnTheNormalizedEmail() {
        Integer usersTable = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_name = 'users'",
                Integer.class);
        assertEquals(1, usersTable, "V2 should create the users table");

        Integer uniqueConstraint = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE table_name = 'users'
                  AND constraint_type = 'UNIQUE'
                  AND constraint_name = 'uq_users_normalized_email'
                """, Integer.class);
        assertEquals(1, uniqueConstraint, "Uniqueness must be enforced on normalized_email");
    }

    @Test
    @Order(1)
    void createsTheWorkspaceTablesWithOneMembershipPerUserPerWorkspace() {
        Integer workspaceTables = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.tables
                WHERE table_name IN ('workspaces', 'workspace_members')
                """, Integer.class);
        assertEquals(2, workspaceTables, "V3 and V4 should create both workspace tables");

        Integer uniqueMembership = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE table_name = 'workspace_members'
                  AND constraint_type = 'UNIQUE'
                  AND constraint_name = 'uq_workspace_members_workspace_user'
                """, Integer.class);
        assertEquals(1, uniqueMembership,
                "A user must not be able to hold two memberships of one workspace");

        Integer roleCheck = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.check_constraints
                WHERE constraint_name = 'ck_workspace_members_role'
                """, Integer.class);
        assertEquals(1, roleCheck, "Only the three known roles may reach the column");

        Integer foreignKeys = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE constraint_type = 'FOREIGN KEY'
                  AND constraint_name IN ('fk_workspaces_created_by',
                                          'fk_workspace_members_workspace',
                                          'fk_workspace_members_user')
                """, Integer.class);
        assertEquals(3, foreignKeys,
                "A workspace and a membership must point at rows that really exist");
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
