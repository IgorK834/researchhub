package dev.researchhub.source.application;

import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.processing.application.SourceIngestInputProvider;
import dev.researchhub.source.domain.SourceVersion;
import dev.researchhub.source.infrastructure.SourceVersionEntity;
import dev.researchhub.source.infrastructure.SourceVersionJobRepository;
import dev.researchhub.source.infrastructure.SourceVersionRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;
import java.util.UUID;

/** Source-owned implementation of the narrow processing input port. */
@Component
@Profile("local")
public class SourceIngestInputResolver implements SourceIngestInputProvider {

    private final SourceVersionRepository versions;
    private final SourceVersionJobRepository jobs;
    private final SourceStorage storage;

    public SourceIngestInputResolver(SourceVersionRepository versions, SourceVersionJobRepository jobs,
                                     SourceStorage storage) {
        this.versions = versions;
        this.jobs = jobs;
        this.storage = storage;
    }

    @Override
    public SourceIngestInput resolve(UUID workspaceId, UUID sourceId, UUID jobId, Duration accessTtl) {
        UUID versionId = jobs.findVersionId(jobId)
                .orElseThrow(() -> new IllegalStateException("Processing source version is not recorded"));
        SourceVersion source = versions.findByWorkspaceIdAndSourceIdAndId(workspaceId, sourceId, versionId)
                .map(SourceVersionEntity::toDomain)
                .orElseThrow(() -> new IllegalStateException("Processing source version is not available in its workspace"));
        try {
            TemporaryReadAccess access = storage.createTemporaryReadAccess(source.storageKey(), accessTtl)
                    .orElseThrow(() -> new IllegalStateException("Source storage cannot create temporary read access"));
            return new SourceIngestInput(source.sourceType().name(), access.uri(), access.expiresAt());
        } catch (IOException failure) {
            throw new IllegalStateException("Temporary source access could not be created", failure);
        }
    }
}
