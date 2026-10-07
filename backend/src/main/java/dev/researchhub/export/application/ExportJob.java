package dev.researchhub.export.application;

import dev.researchhub.export.domain.ExportFormat;
import dev.researchhub.export.domain.Report;
import java.time.Instant;
import java.util.*;

public record ExportJob(UUID id,UUID workspaceId,UUID documentId,UUID requestedBy,long revision,
                        ExportFormat format,Status status,String filename,List<String> warnings,
                        Instant createdAt,Instant startedAt,Instant finishedAt,Instant expiresAt,
                        String failureCode,String sha256,long sizeBytes) {
    public ExportJob { warnings=List.copyOf(warnings); }
    public enum Status { QUEUED, RUNNING, SUCCEEDED, FAILED, EXPIRED }
    public record Claimed(ExportJob job,Report report) {}
    public record Download(ExportJob job,byte[] bytes) {}
}
