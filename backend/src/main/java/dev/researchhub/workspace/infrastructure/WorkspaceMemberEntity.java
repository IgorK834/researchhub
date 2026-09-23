package dev.researchhub.workspace.infrastructure;

import dev.researchhub.workspace.domain.WorkspaceMembership;
import dev.researchhub.workspace.domain.WorkspaceRole;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA mapping for the {@code workspace_members} table created by
 * {@code V4__create_workspace_members.sql}.
 *
 * <p>Both {@code workspaceId} and {@code userId} are plain {@link UUID} columns rather than mapped
 * associations. For {@code userId} that is a module-boundary requirement: {@code workspace} must not
 * import {@code user.infrastructure}. For {@code workspaceId} it keeps the membership row a cheap,
 * independently readable fact — an authorization check reads one row and does not drag a workspace,
 * and later its documents, into the session.
 *
 * <p>The role is stored as its name, and {@code ck_workspace_members_role} pins the accepted values,
 * so adding a {@link WorkspaceRole} constant requires a migration.
 */
@Entity
@Table(name = "workspace_members")
public class WorkspaceMemberEntity {

    @Id
    @UuidGenerator(style = UuidGenerator.Style.VERSION_7)
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 32)
    private WorkspaceRole role;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** Required by JPA. Application code uses {@link #fromDomain(WorkspaceMembership)}. */
    protected WorkspaceMemberEntity() {
    }

    private WorkspaceMemberEntity(UUID id, UUID workspaceId, UUID userId, WorkspaceRole role,
                                  Instant createdAt) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.role = role;
        this.createdAt = createdAt;
    }

    public static WorkspaceMemberEntity fromDomain(WorkspaceMembership membership) {
        return new WorkspaceMemberEntity(
                membership.id(),
                membership.workspaceId(),
                membership.userId(),
                membership.role(),
                membership.createdAt());
    }

    public WorkspaceMembership toDomain() {
        return new WorkspaceMembership(id, workspaceId, userId, role, createdAt);
    }

    public UUID getId() {
        return id;
    }

    public UUID getWorkspaceId() {
        return workspaceId;
    }

    public UUID getUserId() {
        return userId;
    }

    public WorkspaceRole getRole() {
        return role;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

}
