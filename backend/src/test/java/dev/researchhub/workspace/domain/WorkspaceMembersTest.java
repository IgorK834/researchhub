package dev.researchhub.workspace.domain;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The rule that a workspace always keeps at least one owner.
 *
 * <p>Tested directly against the domain type, with no database and no HTTP endpoint, because that is
 * where the rule lives. No route removes or demotes a member yet; the rule is still enforced now so the
 * endpoint that eventually does cannot be written without it.
 */
class WorkspaceMembersTest {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID ADAM = UUID.randomUUID();
    private static final UUID KASIA = UUID.randomUUID();
    private static final UUID MICHAL = UUID.randomUUID();

    private static WorkspaceMembership membership(UUID userId, WorkspaceRole role) {
        return new WorkspaceMembership(UUID.randomUUID(), WORKSPACE, userId, role, NOW);
    }

    private static WorkspaceMembers members(WorkspaceMembership... memberships) {
        return new WorkspaceMembers(WORKSPACE, List.of(memberships));
    }

    @Test
    void findsTheRoleAMemberHolds() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.EDITOR));

        assertEquals(WorkspaceRole.OWNER, members.roleOf(ADAM).orElseThrow());
        assertEquals(WorkspaceRole.EDITOR, members.roleOf(KASIA).orElseThrow());
        assertTrue(members.roleOf(MICHAL).isEmpty(), "A user with no membership holds no role");
    }

    @Test
    void refusesToDemoteTheOnlyOwner() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.EDITOR));

        ConflictException failure = assertThrows(ConflictException.class,
                () -> members.changeRole(ADAM, WorkspaceRole.EDITOR),
                "Demoting the last owner would leave a workspace nobody can manage");

        assertEquals(ApiErrorCode.CONFLICT, failure.code());
        assertTrue(failure.getMessage().contains("at least one owner"),
                "The message should say what the rule is, but was: " + failure.getMessage());
    }

    @Test
    void refusesToRemoveTheOnlyOwner() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.VIEWER));

        assertThrows(ConflictException.class, () -> members.remove(ADAM),
                "Removing the last owner would leave a workspace nobody can manage");
    }

    @Test
    void refusesToDemoteTheOnlyOwnerOfASoleMemberWorkspace() {
        WorkspaceMembers members = members(membership(ADAM, WorkspaceRole.OWNER));

        assertThrows(ConflictException.class, () -> members.changeRole(ADAM, WorkspaceRole.VIEWER));
        assertThrows(ConflictException.class, () -> members.remove(ADAM));
    }

    @Test
    void allowsAnOwnerToStepDownWhenAnotherOwnerRemains() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.OWNER));

        WorkspaceMembership demoted = members.changeRole(ADAM, WorkspaceRole.EDITOR);

        assertEquals(WorkspaceRole.EDITOR, demoted.role());
        assertEquals(ADAM, demoted.userId(), "The returned membership is the one to persist");
        assertEquals(WorkspaceRole.OWNER, members.roleOf(ADAM).orElseThrow(),
                "The decision is pure: the original set is unchanged until the caller writes it");
    }

    @Test
    void allowsAnOwnerToBeRemovedWhenAnotherOwnerRemains() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.OWNER));

        assertEquals(ADAM, members.remove(ADAM).userId());
    }

    @Test
    void demotingOrRemovingANonOwnerIsNeverBlocked() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.EDITOR),
                membership(MICHAL, WorkspaceRole.VIEWER));

        assertEquals(WorkspaceRole.VIEWER, members.changeRole(KASIA, WorkspaceRole.VIEWER).role());
        assertEquals(MICHAL, members.remove(MICHAL).userId());
    }

    @Test
    void promotingAMemberToOwnerIsAllowed() {
        WorkspaceMembers members = members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.VIEWER));

        assertEquals(WorkspaceRole.OWNER, members.changeRole(KASIA, WorkspaceRole.OWNER).role(),
                "Promoting is how the last owner gets a colleague to hand over to");
    }

    @Test
    void reassigningTheSameRoleChangesNothingEvenForTheLastOwner() {
        WorkspaceMembers members = members(membership(ADAM, WorkspaceRole.OWNER));

        assertEquals(WorkspaceRole.OWNER, members.changeRole(ADAM, WorkspaceRole.OWNER).role(),
                "Setting the role a member already has is not a demotion and must not fail");
    }

    @Test
    void rejectsAChangeForSomebodyWhoIsNotAMember() {
        WorkspaceMembers members = members(membership(ADAM, WorkspaceRole.OWNER));

        assertThrows(ResourceNotFoundException.class,
                () -> members.changeRole(MICHAL, WorkspaceRole.EDITOR));
        assertThrows(ResourceNotFoundException.class, () -> members.remove(MICHAL));
    }

    @Test
    void countsOwners() {
        assertEquals(1, members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.EDITOR)).ownerCount());
        assertEquals(2, members(
                membership(ADAM, WorkspaceRole.OWNER),
                membership(KASIA, WorkspaceRole.OWNER)).ownerCount());
    }

    @Test
    void rejectsAMembershipThatBelongsToAnotherWorkspace() {
        WorkspaceMembership elsewhere = new WorkspaceMembership(
                UUID.randomUUID(), UUID.randomUUID(), KASIA, WorkspaceRole.EDITOR, NOW);

        assertThrows(IllegalArgumentException.class,
                () -> new WorkspaceMembers(WORKSPACE, List.of(
                        membership(ADAM, WorkspaceRole.OWNER), elsewhere)),
                "Mixing workspaces would let one workspace's members decide another's rules");
    }

    @Test
    void rejectsTwoMembershipsForTheSameUser() {
        assertThrows(IllegalArgumentException.class,
                () -> new WorkspaceMembers(WORKSPACE, List.of(
                        membership(ADAM, WorkspaceRole.OWNER),
                        membership(ADAM, WorkspaceRole.VIEWER))),
                "Two rows for one user would make the effective role undefined");
    }

    @Test
    void rejectsAWorkspaceWithNoMembers() {
        assertThrows(IllegalArgumentException.class, () -> new WorkspaceMembers(WORKSPACE, List.of()));
    }

    @Test
    void cannotBeMutatedThroughTheListItWasBuiltFrom() {
        List<WorkspaceMembership> mutable = new java.util.ArrayList<>();
        mutable.add(membership(ADAM, WorkspaceRole.OWNER));
        WorkspaceMembers members = new WorkspaceMembers(WORKSPACE, mutable);

        mutable.add(membership(KASIA, WorkspaceRole.OWNER));

        assertEquals(1, members.ownerCount(),
                "The set is copied on construction, so a later change cannot defeat the checks");
    }

}
