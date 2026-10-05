package dev.researchhub.analysis.domain;

/** Engine-independent lifecycle. Structural approval never means that code is trusted. */
public enum AnalysisStatus {
    DRAFT, PLANNING, READY_TO_EXECUTE, QUEUED, RUNNING, SUCCEEDED, FAILED;

    public boolean canTransitionTo(AnalysisStatus next) {
        return switch (this) {
            case DRAFT -> next == PLANNING;
            case PLANNING -> next == READY_TO_EXECUTE || next == FAILED;
            case READY_TO_EXECUTE -> next == QUEUED;
            case QUEUED -> next == RUNNING || next == FAILED;
            case RUNNING -> next == SUCCEEDED || next == FAILED;
            case SUCCEEDED, FAILED -> next == QUEUED;
        };
    }
}
