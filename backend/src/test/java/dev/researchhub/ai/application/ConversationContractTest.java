package dev.researchhub.ai.application;

import dev.researchhub.ai.application.ConversationContracts.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class ConversationContractTest {
    private final ObjectMapper json = new ObjectMapper();
    private String fixture(String name) throws Exception {
        return Files.readString(Path.of("../contracts/ai/conversations/v1/" + name + ".json"));
    }
    @Test void javaAndReactShareOnlyVisibleHistoryAndCompleteTurnFixtures() throws Exception {
        var conversation = json.readValue(fixture("conversation"), Conversation.class);
        var history = json.readValue(fixture("history"), History.class);
        var turn = json.readValue(fixture("completed"), Completion.class);
        assertEquals(conversation, history.conversation());
        assertEquals(java.util.List.of(turn.user(), turn.assistant()), history.messages());
        assertEquals("COMPLETED", turn.assistant().status());
        assertEquals(turn.assistant().content(), turn.assistant().response().answer());
        assertEquals("deterministic", turn.assistant().response().generation().result().model().provider());
        assertEquals(json.readTree(fixture("completed")), json.readTree(json.writeValueAsString(turn)));
        var started = json.readTree(fixture("started"));
        assertEquals(conversation.id().toString(), started.get("conversationId").asString());
        var pending = json.treeToValue(started.get("user"), Message.class);
        assertEquals("PENDING", pending.status());
        assertNull(pending.response());
        assertNull(pending.completedAt());
    }
}
