package dev.researchhub.source.application;

import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.processing.application.SourceIngestInputProvider;
import dev.researchhub.source.domain.Source;
import dev.researchhub.source.infrastructure.SourceRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;
import java.util.UUID;

/** Source-owned implementation of the narrow processing input port. */
@Component
@Profile("local")
public class SourceIngestInputResolver implements SourceIngestInputProvider {

    private final SourceRepository sources;
    private final SourceStorage storage;

    public SourceIngestInputResolver(SourceRepository sources, SourceStorage storage) {
        this.sources = sources;
        this.storage = storage;
    }

    @Override
    public SourceIngestInput resolve(UUID workspaceId, UUID sourceId, Duration accessTtl) {
        Source source = sources.findByWorkspaceIdAndId(workspaceId, sourceId)
                .orElseThrow(() -> new IllegalStateException("Processing source is not available in its workspace"))
                .toDomain();
        try {
            TemporaryReadAccess access = storage.createTemporaryReadAccess(source.storageKey(), accessTtl)
                    .orElseThrow(() -> new IllegalStateException("Source storage cannot create temporary read access"));
            return new SourceIngestInput(source.sourceType().name(), access.uri(), access.expiresAt());
        } catch (IOException failure) {
            throw new IllegalStateException("Temporary source access could not be created", failure);
        }
    }
}
