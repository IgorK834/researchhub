package dev.researchhub.ai.application;
import java.util.*;
import tools.jackson.databind.JsonNode;
import static dev.researchhub.ai.application.GenerationContracts.*;

public final class CalculationPackageContracts {
    private CalculationPackageContracts() {}
    public enum Selection { FULL, TABLE, CHART }
    public record Request(UUID clientProposalId,UUID contextId,UUID analysisId,UUID executionId,
                          Selection selection,String outputId,UUID conversationId,UUID turnId) {
        public Request {require(clientProposalId!=null && contextId!=null && analysisId!=null && executionId!=null && selection!=null);
            require((conversationId==null)==(turnId==null));
            require(selection==Selection.FULL ? outputId==null : outputId!=null && !outputId.isBlank() && outputId.length()<=100);}
    }
    public record Content(String schemaVersion,String workload,UUID analysisId,UUID executionId,
                          Selection selection,String outputId,UUID conversationId,List<JsonNode> blocks) {
        public Content {require("2.0".equals(schemaVersion) && Set.of("DATASET","PROBLEM").contains(workload));
            blocks=bounded(blocks,32);require(!blocks.isEmpty());}
    }
}
