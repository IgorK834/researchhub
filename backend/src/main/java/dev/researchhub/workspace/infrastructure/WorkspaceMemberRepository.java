package dev.researchhub.workspace.infrastructure;

import org.springframework.data.repository.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link WorkspaceMemberEntity}. Like {@link WorkspaceRepository} it extends
 * the bare {@link Repository} marker, so no method returns every membership row in the database.
 *
 * <p>Every read here is scoped by workspace, by user, or by both. That is not a style preference:
 * these rows are the authorization data, and a query with no scope would be a query that answers
 * "who can see what" for the whole installation.
 */
public interface WorkspaceMemberRepository extends Repository<WorkspaceMemberEntity, UUID> {

    <S extends WorkspaceMemberEntity> S saveAndFlush(S member);

    /**
     * The membership that decides whether one user may touch one workspace, or empty when there is
     * none.
     *
     * <p>{@code uq_workspace_members_workspace_user} guarantees there is at most one, so this cannot
     * return an arbitrary row out of several with conflicting roles.
     */
    Optional<WorkspaceMemberEntity> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

    /** Every membership of one workspace, oldest first. The input to role and removal rules. */
    List<WorkspaceMemberEntity> findByWorkspaceIdOrderByCreatedAtAsc(UUID workspaceId);

    /** Every membership held by one user. The only way the workspace list for a caller is built. */
    List<WorkspaceMemberEntity> findByUserId(UUID userId);

    /**
     * Deletes one membership by its own id.
     *
     * <p>By id rather than by {@code (workspaceId, userId)} so the row deleted is exactly the one the
     * domain decided on: {@code WorkspaceMembers.remove} returns that membership after checking the
     * last-owner rule, and passing its id through means no second query can resolve to a different row.
     *
     * <p>This is the only delete in the module, and it removes a grant of access — nothing else. The user
     * row, the workspace row, and anything recording who authored what all survive; see
     * docs/development/persistence.md.
     */
    void deleteById(UUID id);

}
