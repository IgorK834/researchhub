package dev.researchhub.analysis.application;

public interface ProblemPlanner {
    AnalysisContracts.Candidate planProblem(ProblemContracts.PlanningRequest request);
}
