package dev.researchhub.source.application;

import java.util.UUID;

/**
 * The hook for limiting how much a workspace may store in total.
 *
 * <p>Asked twice per upload by {@link SourceService}: before any bytes are read, with the size the client declared
 * (when it declared one), and again after storing, with the real size. A future implementation — per plan, per
 * organisation — answers by throwing; the upload is then refused and its bytes removed.
 *
 * <p>Today's only implementation is {@link UnlimitedWorkspaceSourceQuota}. Replacing it is a matter of providing a
 * different bean; nothing in the upload path changes.
 */
public interface WorkspaceSourceQuota {

    /**
     * Refuses {@code incomingBytes} more for {@code workspaceId}, by throwing, when the workspace cannot take them.
     *
     * @throws dev.researchhub.shared.error.PayloadTooLargeException when the workspace is over its quota
     */
    void requireCapacity(UUID workspaceId, long incomingBytes);

}
