package dev.researchhub.reviewtask.application;

import dev.researchhub.reviewtask.application.ReviewTaskContracts.Status;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ReviewTaskTransitionsTest {
    @Test void terminalTasksMustBeReopenedBeforeWorkOrCancellation() {
        Map<Status,Set<Status>> allowed=Map.of(Status.OPEN,Set.of(Status.OPEN,Status.IN_PROGRESS,Status.DONE,Status.CANCELLED),
            Status.IN_PROGRESS,Set.of(Status.IN_PROGRESS,Status.OPEN,Status.DONE,Status.CANCELLED),Status.DONE,Set.of(Status.DONE,Status.OPEN),Status.CANCELLED,Set.of(Status.CANCELLED,Status.OPEN));
        for(var from:Status.values())for(var to:Status.values())assertEquals(allowed.get(from).contains(to),ReviewTaskContracts.transition(from,to),from+" -> "+to);
    }
}
