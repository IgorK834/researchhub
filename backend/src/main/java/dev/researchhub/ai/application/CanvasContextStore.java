package dev.researchhub.ai.application;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import java.util.*;
public interface CanvasContextStore {
    record Stored(String requestHash, Capture request, Context context) {}
    Optional<Stored> replay(UUID workspace,UUID document,UUID caller,UUID clientRequestId);
    Optional<Stored> find(UUID workspace,UUID document,UUID id);
    Optional<Stored> findById(UUID workspace,UUID id);
    void insert(UUID caller,String requestHash,Capture request,Context context);
}
