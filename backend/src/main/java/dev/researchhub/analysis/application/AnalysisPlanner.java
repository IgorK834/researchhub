package dev.researchhub.analysis.application;

/** Internal AI/data boundary. Receives metadata and inert samples, never storage capabilities or application secrets. */
public interface AnalysisPlanner {
    AnalysisContracts.Candidate plan(AnalysisContracts.PlanningRequest request);
}
