package dev.researchhub.analysis.application;

import dev.researchhub.analysis.application.ProblemContracts.*;

import java.util.*;

public interface ProblemStore {
    Analysis create(Analysis analysis, Create command, String requestHash);

    Optional<Analysis> find(UUID workspace, UUID id);

    boolean beginPlan(UUID workspace, UUID id);

    void planned(Analysis analysis);

    Execution enqueue(
            UUID workspace,
            UUID caller,
            Execution execution,
            ReproductionContracts.RuntimeIdentity runtime);

    List<Execution> executions(UUID workspace, UUID analysis);

    Optional<Execution> execution(UUID workspace, UUID analysis, UUID execution);

    Optional<Job> claim();

    void complete(UUID workspace, Execution execution, Map<String, byte[]> files);

    byte[] artifact(UUID workspace, UUID analysis, UUID execution, String name);

    record Job(
            UUID workspace,
            UUID caller,
            Execution execution,
            ReproductionContracts.RuntimeIdentity runtime) {}
}
