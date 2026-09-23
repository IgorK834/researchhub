package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.shared.infrastructure.persistence.PostgresIntegrationTest;
import dev.researchhub.shared.validation.FieldLengths;
import dev.researchhub.workspace.UserRowFixture;
import dev.researchhub.workspace.domain.WorkspaceCapability;
import dev.researchhub.workspace.domain.WorkspaceMembership;
import dev.researchhub.workspace.domain.WorkspaceRole;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberEntity;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
 * Workspace creation, per-caller reads, and role enforcement, against a real database.
 *
 * <p>Authorization is tested here rather than through HTTP because the rule belongs to the service: an
 * endpoint that forgets to call it is a different bug from the rule itself being wrong. The HTTP
 * behaviour is covered by {@code WorkspaceApiIntegrationTest}, and the atomicity of creation by
 * {@code WorkspaceCreationTransactionIntegrationTest}, which cannot be {@code @Transactional}.
 */
@PostgresIntegrationTest
class WorkspaceServiceIntegrationTest {

    @Autowired
    private WorkspaceService workspaces;

    @Autowired
    private WorkspaceAuthorizationService authorization;

    @Autowired
    private WorkspaceMemberRepository members;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private UUID insertUser(String email) {
        return UserRowFixture.insertUser(jdbcTemplate, email, "Test User");
    }

    private WorkspaceSummary createWorkspace(String name, UUID creator) {
        return workspaces.create(new CreateWorkspaceCommand(name, null, creator));
    }

    private void grant(UUID workspaceId, UUID userId, WorkspaceRole role) {
        members.saveAndFlush(WorkspaceMemberEntity.fromDomain(
                WorkspaceMembership.create(workspaceId, userId, role, Instant.parse("2026-09-23T10:15:30Z"))));
    }

    @Test
    void creatingAWorkspaceInsertsExactlyOneOwnerMembershipForTheCreator() {
        UUID creator = insertUser("ada@example.com");

        WorkspaceSummary created = workspaces.create(
                new CreateWorkspaceCommand("Electronics Lab", "Team 4", creator));

        assertNotNull(created.id());
        assertEquals("OWNER", created.role(), "The creator is the workspace's first owner");

        List<WorkspaceMemberEntity> memberships =
                members.findByWorkspaceIdOrderByCreatedAtAsc(created.id());
        assertEquals(1, memberships.size(), "Creation grants exactly one membership");
        assertEquals(creator, memberships.getFirst().getUserId(),
                "The membership belongs to the creator, not to anyone else");
        assertEquals(WorkspaceRole.OWNER, memberships.getFirst().getRole());
    }

    @Test
    void theCreatedWorkspaceCarriesTheTrimmedNameAndNoDescription() {
        UUID creator = insertUser("ada@example.com");

        WorkspaceSummary created = workspaces.create(
                new CreateWorkspaceCommand("  Electronics Lab  ", "  ", creator));

        assertEquals("Electronics Lab", created.name());
        assertNull(created.description(), "A blank description is stored and returned as absent");
    }

    @Test
    void refusesToCreateAWorkspaceWithAnUnusableName() {
        UUID creator = insertUser("ada@example.com");

        ApiException blank = assertThrows(ApiException.class,
                () -> createWorkspace("   ", creator),
                "The domain rule applies even to a caller that never passed through a DTO");
        assertEquals(ApiErrorCode.VALIDATION_FAILED, blank.code());

        ApiException tooLong = assertThrows(ApiException.class,
                () -> createWorkspace("n".repeat(FieldLengths.NAME_MAX + 1), creator));
        assertEquals(ApiErrorCode.VALIDATION_FAILED, tooLong.code());
    }

    @Test
    void listsOnlyTheWorkspacesTheCallerBelongsTo() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");

        WorkspaceSummary adasWorkspace = createWorkspace("Ada's lab", ada);
        WorkspaceSummary kasiasWorkspace = createWorkspace("Kasia's lab", kasia);

        List<UUID> adaSees = workspaces.listForMember(ada).stream().map(WorkspaceSummary::id).toList();

        assertEquals(List.of(adasWorkspace.id()), adaSees,
                "A workspace only Kasia belongs to must not appear in Ada's list");
        assertEquals(List.of(kasiasWorkspace.id()),
                workspaces.listForMember(kasia).stream().map(WorkspaceSummary::id).toList());
    }

    @Test
    void listsNothingForAUserWhoBelongsToNoWorkspace() {
        UUID ada = insertUser("ada@example.com");
        UUID outsider = insertUser("outsider@example.com");
        createWorkspace("Ada's lab", ada);

        assertEquals(List.of(), workspaces.listForMember(outsider),
                "Belonging to nothing returns an empty list, never every workspace");
    }

    @Test
    void listReportsTheRoleTheCallerHoldsInEachWorkspace() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), kasia, WorkspaceRole.VIEWER);

        assertEquals("OWNER", workspaces.listForMember(ada).getFirst().role());
        assertEquals("VIEWER", workspaces.listForMember(kasia).getFirst().role(),
                "Each caller sees their own role, not the creator's");
    }

    @Test
    void findsAWorkspaceForAMember() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        WorkspaceSummary found = workspaces.findForMember(lab.id(), ada);

        assertEquals(lab.id(), found.id());
        assertEquals("Lab", found.name());
        assertEquals("OWNER", found.role());
    }

    @Test
    void hidesAWorkspaceFromANonMemberTheSameWayAsOneThatDoesNotExist() {
        UUID ada = insertUser("ada@example.com");
        UUID outsider = insertUser("outsider@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        ResourceNotFoundException hidden = assertThrows(ResourceNotFoundException.class,
                () -> workspaces.findForMember(lab.id(), outsider),
                "A non-member must not learn that this workspace exists");
        ResourceNotFoundException missing = assertThrows(ResourceNotFoundException.class,
                () -> workspaces.findForMember(UUID.randomUUID(), outsider));

        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, hidden.code());
        assertEquals(missing.getMessage(), hidden.getMessage(),
                "The two answers must read identically, or the difference is an existence oracle");
    }

    @Test
    void requireMemberReturnsTheRoleHeld() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), kasia, WorkspaceRole.EDITOR);

        assertEquals(WorkspaceRole.OWNER, authorization.requireMember(lab.id(), ada));
        assertEquals(WorkspaceRole.EDITOR, authorization.requireMember(lab.id(), kasia));
    }

    @Test
    void ownerIsAllowedToManageMembers() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        assertEquals(WorkspaceRole.OWNER,
                authorization.requireCapability(lab.id(), ada, WorkspaceCapability.MANAGE_MEMBERS));
        assertEquals(WorkspaceRole.OWNER,
                authorization.requireCapability(lab.id(), ada, WorkspaceCapability.MANAGE_WORKSPACE));
        assertEquals(WorkspaceRole.OWNER,
                authorization.requireCapability(lab.id(), ada, WorkspaceCapability.EDIT_CONTENT));
    }

    @Test
    void editorMayEditContentButIsForbiddenFromManagingMembers() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), kasia, WorkspaceRole.EDITOR);

        assertEquals(WorkspaceRole.EDITOR,
                authorization.requireCapability(lab.id(), kasia, WorkspaceCapability.EDIT_CONTENT));

        ForbiddenException denied = assertThrows(ForbiddenException.class,
                () -> authorization.requireCapability(
                        lab.id(), kasia, WorkspaceCapability.MANAGE_MEMBERS),
                "An editor must not be able to change who belongs to the workspace");

        assertEquals(ApiErrorCode.FORBIDDEN, denied.code(),
                "A member who is simply not allowed gets 403, not a 404 that hides the workspace");
        assertThrows(ForbiddenException.class, () -> authorization.requireCapability(
                lab.id(), kasia, WorkspaceCapability.MANAGE_WORKSPACE));
    }

    @Test
    void viewerMayReadButIsForbiddenFromEditingOrManaging() {
        UUID ada = insertUser("ada@example.com");
        UUID michal = insertUser("michal@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), michal, WorkspaceRole.VIEWER);

        assertEquals(WorkspaceRole.VIEWER,
                authorization.requireCapability(lab.id(), michal, WorkspaceCapability.VIEW_CONTENT));

        assertThrows(ForbiddenException.class, () -> authorization.requireCapability(
                        lab.id(), michal, WorkspaceCapability.EDIT_CONTENT),
                "A viewer must not run a mutating operation on workspace content");
        assertThrows(ForbiddenException.class, () -> authorization.requireCapability(
                lab.id(), michal, WorkspaceCapability.MANAGE_MEMBERS));
    }

    // --- metadata updates ---

    @Test
    void anOwnerCanReplaceTheNameAndDescription() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        WorkspaceSummary updated = workspaces.updateMetadata(lab.id(), ada,
                new UpdateWorkspaceCommand("  Electronics Lab  ", "  Team 4  "));

        assertEquals("Electronics Lab", updated.name(), "The new name is trimmed");
        assertEquals("Team 4", updated.description());
        assertEquals("OWNER", updated.role());
        assertEquals(lab.createdAt(), updated.createdAt(), "createdAt does not move");
        assertNull(updated.archivedAt(), "Editing does not archive");

        assertEquals("Electronics Lab", workspaces.findForMember(lab.id(), ada).name(),
                "The change was persisted");
    }

    @Test
    void anOwnerCanClearTheDescription() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = workspaces.create(new CreateWorkspaceCommand("Lab", "Team 4", ada));

        WorkspaceSummary updated = workspaces.updateMetadata(lab.id(), ada,
                new UpdateWorkspaceCommand("Lab", "   "));

        assertNull(updated.description(), "Blank clears the description, as it does on create");
    }

    @Test
    void refusesAnUnusableNameOnUpdate() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        ApiException blank = assertThrows(ApiException.class, () -> workspaces.updateMetadata(
                lab.id(), ada, new UpdateWorkspaceCommand("   ", null)));
        ApiException tooLong = assertThrows(ApiException.class, () -> workspaces.updateMetadata(
                lab.id(), ada, new UpdateWorkspaceCommand("n".repeat(FieldLengths.NAME_MAX + 1), null)));

        assertEquals(ApiErrorCode.VALIDATION_FAILED, blank.code());
        assertEquals(ApiErrorCode.VALIDATION_FAILED, tooLong.code());
        assertEquals("Lab", workspaces.findForMember(lab.id(), ada).name(), "Nothing was changed");
    }

    @Test
    void anEditorOrViewerCannotChangeTheMetadata() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");
        UUID michal = insertUser("michal@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), kasia, WorkspaceRole.EDITOR);
        grant(lab.id(), michal, WorkspaceRole.VIEWER);

        UpdateWorkspaceCommand rename = new UpdateWorkspaceCommand("Renamed", null);

        assertThrows(ForbiddenException.class,
                () -> workspaces.updateMetadata(lab.id(), kasia, rename),
                "Editing content is an editor's job; editing the workspace itself is not");
        assertThrows(ForbiddenException.class,
                () -> workspaces.updateMetadata(lab.id(), michal, rename));
        assertEquals("Lab", workspaces.findForMember(lab.id(), ada).name());
    }

    @Test
    void aNonMemberCannotChangeTheMetadataAndIsNotToldTheWorkspaceExists() {
        UUID ada = insertUser("ada@example.com");
        UUID outsider = insertUser("outsider@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        ResourceNotFoundException hidden = assertThrows(ResourceNotFoundException.class,
                () -> workspaces.updateMetadata(lab.id(), outsider,
                        new UpdateWorkspaceCommand("Renamed", null)));
        ResourceNotFoundException missing = assertThrows(ResourceNotFoundException.class,
                () -> workspaces.updateMetadata(UUID.randomUUID(), outsider,
                        new UpdateWorkspaceCommand("Renamed", null)));

        assertEquals(missing.getMessage(), hidden.getMessage(),
                "The write path must not become the one place that confirms a workspace exists");
    }

    // --- archiving ---

    @Test
    void anOwnerCanArchiveAndTheWorkspaceLeavesTheList() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        WorkspaceSummary archived = workspaces.archive(lab.id(), ada);

        assertNotNull(archived.archivedAt());
        assertTrue(archived.isArchived());
        assertEquals(List.of(), workspaces.listForMember(ada), "An archived workspace leaves the list");

        WorkspaceSummary stillReadable = workspaces.findForMember(lab.id(), ada);
        assertEquals(archived.archivedAt(), stillReadable.archivedAt(),
                "and is still readable by id, reporting that it is archived");
    }

    @Test
    void archivingKeepsEveryRowIncludingMemberships() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), kasia, WorkspaceRole.VIEWER);

        workspaces.archive(lab.id(), ada);

        assertEquals(1, (int) jdbcTemplate.queryForObject(
                "SELECT count(*) FROM workspaces WHERE id = ?", Integer.class, lab.id()));
        assertEquals(2, members.findByWorkspaceIdOrderByCreatedAtAsc(lab.id()).size(),
                "Archiving throws nobody out of the workspace");
        assertEquals(ada, jdbcTemplate.queryForObject(
                        "SELECT archived_by FROM workspaces WHERE id = ?", UUID.class, lab.id()),
                "and it records who did it");
        assertEquals(List.of(), workspaces.listForMember(kasia),
                "though it no longer appears in any member's list");
        assertEquals(WorkspaceRole.VIEWER,
                members.findByWorkspaceIdAndUserId(lab.id(), kasia).orElseThrow().getRole(),
                "and the role that membership carries is untouched");
    }

    @Test
    void archivingTwiceKeepsTheOriginalTimestamp() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        WorkspaceSummary first = workspaces.archive(lab.id(), ada);
        WorkspaceSummary again = workspaces.archive(lab.id(), ada);

        assertEquals(first.archivedAt(), again.archivedAt(),
                "A retried archive reports the current state rather than rewriting history");
    }

    @Test
    void anEditorOrViewerCannotArchive() {
        UUID ada = insertUser("ada@example.com");
        UUID kasia = insertUser("kasia@example.com");
        UUID michal = insertUser("michal@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        grant(lab.id(), kasia, WorkspaceRole.EDITOR);
        grant(lab.id(), michal, WorkspaceRole.VIEWER);

        assertThrows(ForbiddenException.class, () -> workspaces.archive(lab.id(), kasia));
        assertThrows(ForbiddenException.class, () -> workspaces.archive(lab.id(), michal));
        assertNull(workspaces.findForMember(lab.id(), ada).archivedAt(), "Still active");
    }

    @Test
    void aNonMemberCannotArchive() {
        UUID ada = insertUser("ada@example.com");
        UUID outsider = insertUser("outsider@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        assertThrows(ResourceNotFoundException.class, () -> workspaces.archive(lab.id(), outsider));
        assertNull(workspaces.findForMember(lab.id(), ada).archivedAt());
    }

    @Test
    void anArchivedWorkspaceCannotBeEdited() {
        UUID ada = insertUser("ada@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);
        workspaces.archive(lab.id(), ada);

        ConflictException rejected = assertThrows(ConflictException.class,
                () -> workspaces.updateMetadata(lab.id(), ada,
                        new UpdateWorkspaceCommand("Renamed", null)));

        assertEquals(ApiErrorCode.CONFLICT, rejected.code());
        assertEquals("Lab", workspaces.findForMember(lab.id(), ada).name());
    }

    @Test
    void aNonMemberIsHiddenRatherThanForbiddenEvenWhenAskingForACapability() {
        UUID ada = insertUser("ada@example.com");
        UUID outsider = insertUser("outsider@example.com");
        WorkspaceSummary lab = createWorkspace("Lab", ada);

        ResourceNotFoundException notFound = assertThrows(ResourceNotFoundException.class,
                () -> authorization.requireCapability(
                        lab.id(), outsider, WorkspaceCapability.VIEW_CONTENT),
                "A 403 here would confirm the workspace exists to someone with no membership");

        assertTrue(notFound.getMessage().contains("not found"),
                "The message should be the ordinary not-found one, but was: " + notFound.getMessage());
    }

}
