package dev.researchhub.analysis.application;

import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import java.util.UUID;

/** Read-only saved solution capability. It cannot plan, execute, or infer. */
@Service
public class SolutionService {
    private final ProblemStore store;
    private final WorkspaceAuthorizationService access;
    public SolutionService(ProblemStore store,WorkspaceAuthorizationService access) {this.store=store;this.access=access;}
    public SolutionContracts.Bundle find(UUID workspace,UUID caller,UUID analysis,UUID execution) {
        access.requireContentReader(workspace,caller);
        var e=store.execution(workspace,analysis,execution).orElseThrow(()->new ResourceNotFoundException("Saved solution was not found"));
        if(!e.status().equals("SUCCEEDED") || e.solution()==null || e.verification()==null || !e.verification().status().equals("CHECKED"))
            throw new ConflictException("Choose a successful run with a saved checked solution; reproduce an older run to create one");
        return e.solution();
    }
}
