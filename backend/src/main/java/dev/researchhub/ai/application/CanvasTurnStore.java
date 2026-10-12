package dev.researchhub.ai.application;
import java.util.*;
import dev.researchhub.ai.application.CanvasConversationContracts.*;
import dev.researchhub.shared.error.ApiErrorCode;
public interface CanvasTurnStore {
    TurnState first(UUID workspace,UUID caller,FirstTurn request,Origin origin);
    TurnState reserve(UUID workspace,UUID caller,UUID conversation,Turn request);
    TurnState find(UUID workspace,UUID conversation,UUID turn);
    List<TurnState> history(UUID workspace,UUID conversation,List<UUID> messageIds);
    Optional<Work> claim();
    boolean beginModel(Work work);
    default void admitRetrieval(Work work) {}
    void proposal(Work work,CanvasProposalContracts.Proposal proposal,MemorySummary memory);
    void problem(Work work,String statement,MemorySummary memory);
    void analysis(Work work,List<dev.researchhub.analysis.application.AnalysisContracts.Input> inputs,MemorySummary memory);
    UUID prepareDataset(Work work,List<dev.researchhub.analysis.application.AnalysisContracts.Input> inputs,MemorySummary memory);
    void startDatasetExecution(Work work);
    void deferExecution(Work work);
    void finishExecution(Work work,String text);
    void complete(Work work,QuestionContracts.Response response,String kind,MemorySummary memory);
    void fail(Work work,ApiErrorCode code);
    TurnState cancel(UUID workspace,UUID caller,UUID conversation,UUID turn);
}
