package dev.researchhub.analysis.application;

import java.util.*;

/** Mutable current-input assessment is deliberately outside frozen execution/provenance contracts. */
public record AnalysisStaleness(boolean stale,List<String> staleReasons,List<ChangedInput> changedInputs) {
    public record Version(UUID id,int number,String sha256) {}
    public record ChangedInput(UUID sourceId,Version originalVersion,Version currentVersion,String reason) {}
    public AnalysisStaleness {staleReasons=List.copyOf(staleReasons);changedInputs=List.copyOf(changedInputs);}
    public static AnalysisStaleness current() {return new AnalysisStaleness(false,List.of(),List.of());}
}
