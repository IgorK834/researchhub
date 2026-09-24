package dev.researchhub.source.application;

import org.springframework.stereotype.Component;

import java.util.UUID;

/** No workspace quota yet: every workspace may store any number of sources, each within {@link SourceLimits}. */
@Component
public class UnlimitedWorkspaceSourceQuota implements WorkspaceSourceQuota {

    @Override
    public void requireCapacity(UUID workspaceId, long incomingBytes) {
        // Deliberately empty. The hook exists so a quota can be added without touching the upload path.
    }

}
