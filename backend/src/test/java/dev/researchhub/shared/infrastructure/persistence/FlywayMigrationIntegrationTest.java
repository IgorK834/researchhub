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

        Integer archivalMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '5'",
                Integer.class);
        assertEquals(1, archivalMigrationRows, "Flyway should record V5__add_workspace_archival.sql");

        Integer documentsMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '6'",
                Integer.class);
        assertEquals(1, documentsMigrationRows, "Flyway should record V6__create_documents.sql");

        Integer versionsMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '7'",
                Integer.class);
        assertEquals(1, versionsMigrationRows, "Flyway should record V7__create_document_versions.sql");

        Integer sourcesMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '8'",
                Integer.class);
        assertEquals(1, sourcesMigrationRows, "Flyway should record V8__create_sources.sql");

        Integer sourceFailureMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '9'",
                Integer.class);
        assertEquals(1, sourceFailureMigrationRows, "Flyway should record V9__add_source_failure_summary.sql");

        Integer processingJobsMigrationRows = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '10'",
                Integer.class);
        assertEquals(1, processingJobsMigrationRows, "Flyway should record V10__create_processing_jobs.sql");

        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true AND version = '11'", Integer.class));
        assertEquals("jsonb", jdbcTemplate.queryForObject(
                "SELECT data_type FROM information_schema.columns WHERE table_name = 'source_extractions' AND column_name = 'payload'", String.class));

        Integer appliedVersions = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE success = true",
                Integer.class);
        assertEquals(14, appliedVersions,
                "A fresh database should have exactly versions 1 through 14 applied");
    }

    /**
     * V6 gives documents a workspace, a bounded JSON body, and one content format.
     *
     * <p>The constraints are the schema's own opinion about what a document is, so they are asserted here rather
     * than left to the application: a writer that bypasses the domain still cannot store an array, a megabyte
     * of prose, or an HTML blob.
     */
    @Test
    @Order(1)
    void createsTheDocumentsTableWithABoundedJsonBody() {
        Integer documentsTable = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_name = 'documents'",
                Integer.class);
        assertEquals(1, documentsTable, "V6 should create the documents table");

        assertEquals("jsonb", jdbcTemplate.queryForObject("""
                        SELECT data_type FROM information_schema.columns
                        WHERE table_name = 'documents' AND column_name = 'content'
                        """, String.class),
                "The content column is jsonb, which is what lets the database reject a non-object");

        Integer checks = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.check_constraints
                WHERE constraint_name IN ('ck_documents_content_is_object',
                                          'ck_documents_content_size',
                                          'ck_documents_content_format',
                                          'ck_documents_title_not_blank',
                                          'ck_documents_revision_positive')
                """, Integer.class);
        assertEquals(5, checks, "Every document rule with a schema-level answer should have one");

        Integer documentForeignKeys = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE constraint_type = 'FOREIGN KEY'
                  AND constraint_name IN ('fk_documents_workspace', 'fk_documents_created_by')
                """, Integer.class);
        assertEquals(2, documentForeignKeys,
                "A document points at a real workspace and a real author");
    }

    /** V8/V9 give sources a closed type mapping, an opaque key, an immutable original, and bounded failure metadata. */
    @Test
    @Order(1)
    void createsTheSourcesTableWithItsMappingAndImmutability() {
        Integer constraints = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE table_name = 'sources'
                  AND constraint_name IN ('pk_sources',
                                          'fk_sources_workspace',
                                          'fk_sources_uploaded_by',
                                          'uq_sources_storage_key',
                                          'ck_sources_source_type',
                                          'ck_sources_media_type_matches_type',
                                          'ck_sources_status',
                                          'ck_sources_size_bytes',
                                          'ck_sources_storage_key_format',
                                          'ck_sources_content_sha256_format',
                                          'ck_sources_original_filename_not_blank',
                                          'ck_sources_display_name_not_blank',
                                          'ck_sources_failure_summary_matches_status')
                """, Integer.class);
        assertEquals(13, constraints, "V8/V9 should create the source metadata table's keys and checks");

        assertEquals(1000, jdbcTemplate.queryForObject("""
                SELECT character_maximum_length FROM information_schema.columns
                WHERE table_name = 'sources' AND column_name = 'failure_summary'
                """, Integer.class), "A failure summary must stay concise enough for workspace metadata");

        Integer trigger = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.triggers
                WHERE event_object_table = 'sources'
                  AND trigger_name = 'tg_sources_original_is_immutable'
                  AND event_manipulation = 'UPDATE'
                """, Integer.class);
        assertEquals(1, trigger, "The original input refuses updates");
    }

    /** V10 makes async delivery recoverable, bounded, and idempotent in PostgreSQL. */
    @Test
    @Order(1)
    void createsTheDurableProcessingQueueWithStateGuardrails() {
        Integer constraints = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE table_name = 'processing_jobs'
                  AND constraint_name IN ('pk_processing_jobs',
                                          'fk_processing_jobs_workspace',
                                          'uq_processing_jobs_resource_generation',
                                          'ck_processing_jobs_type',
                                          'ck_processing_jobs_resource_type',
                                          'ck_processing_jobs_status',
                                          'ck_processing_jobs_attempt_count',
                                          'ck_processing_jobs_error_pair',
                                          'ck_processing_jobs_state_fields',
                                          'ck_processing_jobs_time_order')
                """, Integer.class);
        assertEquals(10, constraints, "Job identity, state, retry and workspace rules belong to the schema too");

        assertEquals(500, jdbcTemplate.queryForObject("""
                SELECT character_maximum_length FROM information_schema.columns
                WHERE table_name = 'processing_jobs' AND column_name = 'last_error_message'
                """, Integer.class), "Only a bounded user-safe failure summary may be persisted");

        Integer trigger = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.triggers
                WHERE event_object_table = 'processing_jobs'
                  AND trigger_name = 'tg_processing_job_identity_is_immutable'
                  AND event_manipulation = 'UPDATE'
                """, Integer.class);
        assertEquals(1, trigger, "A processing job cannot be retargeted after creation");
    }

    /** V7 gives documents an immutable history. */
    @Test
    @Order(1)
    void createsTheDocumentVersionsTableWithAnImmutabilityTrigger() {
        Integer constraints = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE table_name = 'document_versions'
                  AND constraint_name IN ('uq_document_versions_document_revision',
                                          'fk_document_versions_document',
                                          'fk_document_versions_created_by',
                                          'fk_document_versions_restored_from',
                                          'ck_document_versions_reason',
                                          'ck_document_versions_restore_source',
                                          'ck_document_versions_content_is_object',
                                          'ck_document_versions_content_size')
                """, Integer.class);
        assertEquals(8, constraints, "V7 should create the history table's keys and checks");

        Integer triggerEvents = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.triggers
                WHERE event_object_table = 'document_versions'
                  AND trigger_name = 'tg_document_versions_immutable'
                  AND event_manipulation IN ('UPDATE', 'DELETE')
                """, Integer.class);
        assertEquals(2, triggerEvents, "Snapshots refuse both UPDATE and DELETE");
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

    /**
     * V5 adds archival as two nullable columns and a check constraint, and nothing else.
     *
     * <p>Archiving is a soft state change: the migration must not have introduced a cascade or a trigger
     * that could remove a row, because the sources, documents, and results that will reference a workspace
     * have to stay traceable (docs/context.md sections 3.3 and 3.4).
     */
    @Test
    @Order(1)
    void addsArchivalColumnsThatCanOnlyBeSetTogether() {
        Integer archivalColumns = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_name = 'workspaces'
                  AND column_name IN ('archived_at', 'archived_by')
                  AND is_nullable = 'YES'
                """, Integer.class);
        assertEquals(2, archivalColumns,
                "V5 should add both archival columns, both nullable, because NULL means active");

        Integer archivalCheck = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.check_constraints
                WHERE constraint_name = 'ck_workspaces_archived_together'
                """, Integer.class);
        assertEquals(1, archivalCheck,
                "A row recording half of the archival event must not be storable");

        Integer archivedByForeignKey = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.table_constraints
                WHERE constraint_type = 'FOREIGN KEY'
                  AND constraint_name = 'fk_workspaces_archived_by'
                """, Integer.class);
        assertEquals(1, archivedByForeignKey, "archived_by must point at a real identity");

        Integer cascades = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.referential_constraints
                WHERE constraint_schema = current_schema()
                  AND (delete_rule <> 'NO ACTION' OR update_rule <> 'NO ACTION')
                  AND constraint_name IN ('fk_workspaces_created_by', 'fk_workspaces_archived_by', 'fk_workspace_members_workspace', 'fk_workspace_members_user')
                """, Integer.class);
        assertEquals(0, cascades,
                "No workspace foreign key may cascade: archiving retires a workspace, it never deletes");

        Integer triggers = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.triggers
                WHERE event_object_table IN ('workspaces', 'workspace_members')
                """, Integer.class);
        assertEquals(0, triggers, "and nothing runs behind the application's back");
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
