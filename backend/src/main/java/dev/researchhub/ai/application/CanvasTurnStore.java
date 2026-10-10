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
    void complete(Work work,QuestionContracts.Response response,String kind,MemorySummary memory);
    void fail(Work work,ApiErrorCode code);
    TurnState cancel(UUID workspace,UUID caller,UUID conversation,UUID turn);
}
