package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
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
