package dev.researchhub.workspace.infrastructure;

import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.workspace.UserRowFixture;
import dev.researchhub.workspace.domain.Workspace;
import dev.researchhub.workspace.domain.WorkspaceMembership;
import dev.researchhub.workspace.domain.WorkspaceRole;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the {@code workspaces} and {@code workspace_members} tables behave as V3, V4, and
 * docs/development/persistence.md promise.
 *
 * <p>Runs against PostgreSQL 17 in Testcontainers, so these assertions exercise the real unique index,
 * check constraints, and foreign keys rather than Hibernate's in-memory view of them. Constraints that
 * the application also checks are tested here anyway: the database is the only thing that still holds
 * when two requests race.
 */
@PostgresIntegrationTest
class WorkspaceRepositoryIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    @Autowired
    private WorkspaceRepository workspaces;

    @Autowired
    private WorkspaceMemberRepository members;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID insertUser(String email) {
        return UserRowFixture.insertUser(jdbcTemplate, email, "Test User");
    }

    private WorkspaceEntity insertWorkspace(String name, String description, UUID createdBy) {
        return workspaces.saveAndFlush(
                WorkspaceEntity.fromDomain(Workspace.create(name, description, createdBy, NOW)));
    }

    private WorkspaceMemberEntity insertMember(UUID workspaceId, UUID userId, WorkspaceRole role) {
        return members.saveAndFlush(WorkspaceMemberEntity.fromDomain(
                WorkspaceMembership.create(workspaceId, userId, role, NOW)));
    }

    @Test
    void savesAWorkspaceAndAssignsAUuid() {
        UUID creator = insertUser("ada@example.com");

        WorkspaceEntity saved = insertWorkspace("Electronics Lab", "Team 4", creator);

        assertNotNull(saved.getId(), "Hibernate should assign the UUID on insert");
        assertEquals("Electronics Lab", saved.getName());
        assertEquals("Team 4", saved.getDescription());
        assertEquals(creator, saved.getCreatedBy());
        assertEquals(NOW, saved.getCreatedAt());
    }

    @Test
    void storesNullForAWorkspaceWithoutADescription() {
        UUID creator = insertUser("ada@example.com");

        UUID id = insertWorkspace("Notes", "   ", creator).getId();

        assertNull(jdbcTemplate.queryForObject(
                        "SELECT description FROM workspaces WHERE id = ?", String.class, id),
                "A blank description is normalized to NULL, so absent has one representation");
    }

    @Test
    void rejectsAWorkspaceWhoseCreatorIsNotARealUser() {
        Workspace orphan = Workspace.create("Ghost", null, UUID.randomUUID(), NOW);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> workspaces.saveAndFlush(WorkspaceEntity.fromDomain(orphan)),
                "created_by must point at a real identity");

        assertTrue(failure.getMessage().contains("fk_workspaces_created_by"),
                "Expected the created_by foreign key to fail, but was: " + failure.getMessage());
    }

    @Test
    void rejectsABlankWorkspaceNameEvenWhenTheDomainIsBypassed() {
        UUID creator = insertUser("ada@example.com");

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at)
                        VALUES (?, '   ', NULL, ?, ?, ?)
                        """, UUID.randomUUID(), creator,
                        UserRowFixture.timestamp(NOW), UserRowFixture.timestamp(NOW)),
                "The check constraint is the backstop for a writer that skips the domain type");

        assertTrue(failure.getMessage().contains("ck_workspaces_name_not_blank"),
                "Expected the not-blank check to fail, but was: " + failure.getMessage());
    }

    @Test
    void storesTheMembershipRoleByName() {
        UUID creator = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, creator).getId();

        UUID membershipId = insertMember(workspaceId, creator, WorkspaceRole.OWNER).getId();

        assertEquals("OWNER", jdbcTemplate.queryForObject(
                        "SELECT role FROM workspace_members WHERE id = ?", String.class, membershipId),
                "The role is stored as its name, which is what ck_workspace_members_role pins");
    }

    @Test
    void rejectsASecondMembershipForTheSameUserInTheSameWorkspace() {
        UUID creator = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, creator).getId();
        insertMember(workspaceId, creator, WorkspaceRole.OWNER);

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertMember(workspaceId, creator, WorkspaceRole.VIEWER),
                "One membership per user per workspace, or the effective role is undefined");

        assertTrue(failure.getMessage().contains("uq_workspace_members_workspace_user"),
                "Expected the (workspace_id, user_id) unique constraint to fail, but was: "
                        + failure.getMessage());
    }

    @Test
    void allowsTheSameUserToBelongToDifferentWorkspaces() {
        UUID user = insertUser("ada@example.com");
        UUID first = insertWorkspace("Lab", null, user).getId();
        UUID second = insertWorkspace("Thesis", null, user).getId();

        insertMember(first, user, WorkspaceRole.OWNER);
        insertMember(second, user, WorkspaceRole.EDITOR);

        assertEquals(WorkspaceRole.OWNER,
                members.findByWorkspaceIdAndUserId(first, user).orElseThrow().getRole());
        assertEquals(WorkspaceRole.EDITOR,
                members.findByWorkspaceIdAndUserId(second, user).orElseThrow().getRole(),
                "Uniqueness is per workspace, so a role in one says nothing about another");
    }

    @Test
    void rejectsAMembershipForAUserThatDoesNotExist() {
        UUID creator = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, creator).getId();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertMember(workspaceId, UUID.randomUUID(), WorkspaceRole.EDITOR));

        assertTrue(failure.getMessage().contains("fk_workspace_members_user"),
                "Expected the user foreign key to fail, but was: " + failure.getMessage());
    }

    @Test
    void rejectsAMembershipForAWorkspaceThatDoesNotExist() {
        UUID user = insertUser("ada@example.com");

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> insertMember(UUID.randomUUID(), user, WorkspaceRole.EDITOR));

        assertTrue(failure.getMessage().contains("fk_workspace_members_workspace"),
                "Expected the workspace foreign key to fail, but was: " + failure.getMessage());
    }

    @Test
    void rejectsARoleThatIsNotOneOfTheThreeKnownRoles() {
        UUID creator = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, creator).getId();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
                        VALUES (?, ?, ?, 'SUPERUSER', ?)
                        """, UUID.randomUUID(), workspaceId, creator, UserRowFixture.timestamp(NOW)),
                "A role the application does not know must not reach the column");

        assertTrue(failure.getMessage().contains("ck_workspace_members_role"),
                "Expected the role check constraint to fail, but was: " + failure.getMessage());
    }

    @Test
    void findsTheWorkspacesForASetOfIdsNewestFirst() {
        UUID user = insertUser("ada@example.com");
        UUID older = workspaces.saveAndFlush(WorkspaceEntity.fromDomain(
                Workspace.create("Older", null, user, NOW))).getId();
        UUID newer = workspaces.saveAndFlush(WorkspaceEntity.fromDomain(
                Workspace.create("Newer", null, user, NOW.plusSeconds(60)))).getId();

        List<UUID> found = workspaces
                .findByIdInAndArchivedAtIsNullOrderByCreatedAtDesc(List.of(older, newer)).stream()
                .map(WorkspaceEntity::getId)
                .toList();

        assertEquals(List.of(newer, older), found, "The list is newest first");
    }

    @Test
    void findsNothingForAnEmptySetOfIds() {
        assertEquals(List.of(), workspaces.findByIdInAndArchivedAtIsNullOrderByCreatedAtDesc(List.of()),
                "A user with no memberships asks for no ids and must not receive every workspace");
    }

    @Test
    void leavesArchivedWorkspacesOutOfTheScopedList() {
        UUID user = insertUser("ada@example.com");
        UUID active = insertWorkspace("Active", null, user).getId();
        Workspace toArchive = insertWorkspace("Retired", null, user).toDomain();
        UUID archived = workspaces.saveAndFlush(
                WorkspaceEntity.fromDomain(toArchive.archive(user, NOW.plusSeconds(60)))).getId();

        List<UUID> found = workspaces
                .findByIdInAndArchivedAtIsNullOrderByCreatedAtDesc(List.of(active, archived)).stream()
                .map(WorkspaceEntity::getId)
                .toList();

        assertEquals(List.of(active), found,
                "The database does the filtering, so an archived workspace never reaches the list");
        assertNotNull(workspaces.findById(archived).orElseThrow().getArchivedAt(),
                "and it is still there to be read by id");
    }

    @Test
    void storesWhenAndByWhomAWorkspaceWasArchived() {
        UUID user = insertUser("ada@example.com");
        Workspace workspace = insertWorkspace("Retired", null, user).toDomain();

        WorkspaceEntity archived = workspaces.saveAndFlush(
                WorkspaceEntity.fromDomain(workspace.archive(user, NOW.plusSeconds(60))));

        assertEquals(NOW.plusSeconds(60), archived.getArchivedAt());
        assertEquals(user, archived.getArchivedBy());
        assertEquals(workspace.id(), archived.getId(), "Archiving updates the row, it does not insert one");
        assertTrue(archived.toDomain().isArchived());
    }

    @Test
    void rejectsAnArchivedAtWithoutAnArchivedBy() {
        UUID creator = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, creator).getId();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        UPDATE workspaces SET archived_at = ? WHERE id = ?
                        """, UserRowFixture.timestamp(NOW), workspaceId),
                "The two archival columns describe one event, so half of it must not be storable");

        assertTrue(failure.getMessage().contains("ck_workspaces_archived_together"),
                "Expected the archival check constraint to fail, but was: " + failure.getMessage());
    }

    @Test
    void rejectsAnArchivedByWithoutAnArchivedAt() {
        UUID creator = insertUser("ada@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, creator).getId();

        assertThrows(DataIntegrityViolationException.class,
                () -> jdbcTemplate.update("""
                        UPDATE workspaces SET archived_by = ? WHERE id = ?
                        """, creator, workspaceId));
    }

    @Test
    void rejectsArchivalByAUserThatDoesNotExist() {
        UUID creator = insertUser("ada@example.com");
        Workspace workspace = insertWorkspace("Lab", null, creator).toDomain();

        DataIntegrityViolationException failure = assertThrows(DataIntegrityViolationException.class,
                () -> workspaces.saveAndFlush(WorkspaceEntity.fromDomain(
                        workspace.archive(UUID.randomUUID(), NOW))));

        assertTrue(failure.getMessage().contains("fk_workspaces_archived_by"),
                "Expected the archived_by foreign key to fail, but was: " + failure.getMessage());
    }

    @Test
    void listsEveryMembershipOfOneWorkspaceOldestFirst() {
        UUID owner = insertUser("ada@example.com");
        UUID editor = insertUser("kasia@example.com");
        UUID workspaceId = insertWorkspace("Lab", null, owner).getId();
        insertMember(workspaceId, owner, WorkspaceRole.OWNER);
        members.saveAndFlush(WorkspaceMemberEntity.fromDomain(
                WorkspaceMembership.create(workspaceId, editor, WorkspaceRole.EDITOR, NOW.plusSeconds(60))));

        List<WorkspaceRole> roles = members.findByWorkspaceIdOrderByCreatedAtAsc(workspaceId).stream()
                .map(WorkspaceMemberEntity::getRole)
                .toList();

        assertEquals(List.of(WorkspaceRole.OWNER, WorkspaceRole.EDITOR), roles);
    }

    @Test
    void duplicatesNoUserColumnOntoTheWorkspaceTables() {
        Integer copiedColumns = jdbcTemplate.queryForObject("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_name IN ('workspaces', 'workspace_members')
                  AND column_name IN ('email', 'normalized_email', 'password_hash', 'password', 'display_name')
                """, Integer.class);

        assertEquals(0, copiedColumns,
                "User columns belong to the users table; these tables reference an id and nothing else");
    }

}
