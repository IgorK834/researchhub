package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.AnalysisContracts.*;
import java.time.Instant;
import java.util.*;

public interface AnalysisStore {
    Analysis create(Analysis analysis);
    Analysis find(UUID workspaceId,UUID id);
    List<Analysis> list(UUID workspaceId,int offset);
    boolean beginPlanning(UUID workspaceId,UUID id,Instant now);
    void recordAttempt(UUID workspaceId,UUID id,PlanAudit audit);
    void complete(UUID workspaceId,UUID id,UUID planId,Plan plan,Instant now);
    void fail(UUID workspaceId,UUID id,String code,Instant now);
    List<PlanAudit> attempts(UUID workspaceId,UUID id);
}
