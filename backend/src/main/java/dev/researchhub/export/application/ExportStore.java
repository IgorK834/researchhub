package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report;
import java.time.Instant;
import java.util.*;

public interface ExportStore {
    ExportJob enqueue(ExportJob job,Report report);
    ExportJob find(UUID workspace,UUID document,UUID job);
    Report report(UUID workspace,UUID document,UUID job);
    ExportJob.Download download(UUID workspace,UUID document,UUID job);
    Optional<ExportJob.Claimed> claim(Instant now);
    void complete(UUID job,byte[] bytes,String failure,Instant now);
    void maintain(Instant staleBefore,Instant now);
}
