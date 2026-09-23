package dev.researchhub.workspace;

import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.UUID;

/**
 * Inserts {@code workspace_members} rows with SQL.
 *
 * <p>Needed because there is no member-management API yet: creating a workspace grants exactly one
 * {@code OWNER} membership to its creator, so an {@code EDITOR} or {@code VIEWER} cannot be produced over
 * HTTP. Writing the row directly is how a test can ask what an editor or a viewer is allowed to do — the
 * question RH-051's role rules exist to answer — without waiting for the endpoint that will eventually
 * grant it.
 *
 * <p>Deliberately raw SQL rather than the module's repository: the point is to set up a state, not to
 * exercise the code under test on the way in.
 */
public final class MembershipRowFixture {

    private static final Instant NOW = Instant.parse("2026-09-23T10:15:30Z");

    /**
     * Grants {@code userId} the given role in {@code workspaceId} and returns the membership id.
     *
     * @param role one of {@code OWNER}, {@code EDITOR}, or {@code VIEWER}; anything else is rejected by
     *             {@code ck_workspace_members_role}
     */
    public static UUID insertMembership(JdbcTemplate jdbcTemplate, UUID workspaceId, UUID userId,
                                       String role) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update("""
                INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
                VALUES (?, ?, ?, ?, ?)
                """, id, workspaceId, userId, role, UserRowFixture.timestamp(NOW));
        return id;
    }

    private MembershipRowFixture() {
    }

}
