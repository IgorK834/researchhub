package dev.researchhub.source.application;

import java.util.UUID;
import dev.researchhub.source.application.ExternalSourceContracts.*;

public interface ExternalSourceStore {
    Search saveSearch(Search search);
    Search findSearch(UUID workspaceId, UUID searchId);
    Reference record(Reference reference);
    Page list(UUID workspaceId, int page, int size);
}
