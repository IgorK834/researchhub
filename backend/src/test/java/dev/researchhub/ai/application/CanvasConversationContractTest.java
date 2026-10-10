package dev.researchhub.ai.application;
import dev.researchhub.ai.application.CanvasConversationContracts.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class CanvasConversationContractTest {
    ObjectMapper json=new ObjectMapper();Path fixtures=Path.of("../contracts/ai/conversations/v2");
    @Test void sharedFixturesMatchJavaAndUtf8EnvelopeBudget() throws Exception {
        var first=json.readValue(Files.readString(fixtures.resolve("firstturn.json")),FirstTurn.class);
        assertEquals(first.contextId(),first.turn().contextId());
        var state=json.readValue(Files.readString(fixtures.resolve("state.json")),TurnState.class);assertEquals("ACCEPTED",state.status());
        var request=json.readValue(Files.readString(fixtures.resolve("model-request.json")),ContextContracts.ContextualRequest.class);
        var rebuilt=new GroundedContextBuilder().build(request.request(),List.of(new GenerationContracts.Citation(request.request().evidence().getFirst().chunkId(),UUID.randomUUID(),UUID.randomUUID(),null,"v",request.request().evidence().getFirst().contentHash(),null,null,null,List.of(),"Title")),List.of(),request.context().summary().budget(),request.conversationContext());
        assertEquals("3.0",rebuilt.schemaVersion());assertEquals("3.0",rebuilt.context().summary().builderVersion());
        assertTrue(rebuilt.context().summary().tokenUpperBound()>new GroundedContextBuilder().build(request.request(),List.of(new GenerationContracts.Citation(request.request().evidence().getFirst().chunkId(),UUID.randomUUID(),UUID.randomUUID(),null,"v",request.request().evidence().getFirst().contentHash(),null,null,null,List.of(),"Title")),request.context().summary().budget()).context().summary().tokenUpperBound());
    }
    @Test void identitiesVersionLengthsAndScopeAreStrict() {
        UUID context=UUID.randomUUID(),id=UUID.randomUUID();Scope empty=new Scope(List.of(),List.of());
        assertThrows(IllegalArgumentException.class,()->new Scope(List.of(id,id),List.of()));
        assertThrows(IllegalArgumentException.class,()->new Scope(null,List.of()));
        assertThrows(IllegalArgumentException.class,()->new Turn("2.0",id,context,Intent.ANSWER,"Text",null,null,empty));
        assertThrows(IllegalArgumentException.class,()->new Turn("1.0",null,context,Intent.ANSWER,"Text",null,null,empty));
        assertThrows(IllegalArgumentException.class,()->new Turn("1.0",id,null,Intent.ANSWER,"Text",null,null,empty));
        assertThrows(IllegalArgumentException.class,()->new Turn("1.0",id,context,null,"Text",null,null,empty));
        assertThrows(IllegalArgumentException.class,()->new Turn("1.0",id,context,Intent.ANSWER,"Text",null,null,null));
        assertThrows(IllegalArgumentException.class,()->new Turn("1.0",id,context,Intent.ANSWER,"",null,null,empty));
        assertThrows(IllegalArgumentException.class,()->new Turn("1.0",id,context,Intent.ANSWER,"😀".repeat(4001),null,null,empty));
        var turn=new Turn("1.0",id,context,Intent.ANSWER,"a".repeat(8000),null,null,empty);
        assertThrows(IllegalArgumentException.class,()->new FirstTurn("1.0",id,UUID.randomUUID(),turn));
        assertThrows(IllegalArgumentException.class,()->new FirstTurn("0",id,context,turn));
        assertThrows(IllegalArgumentException.class,()->new FirstTurn("1.0",null,context,turn));
        assertThrows(IllegalArgumentException.class,()->new FirstTurn("1.0",id,null,turn));
        assertThrows(IllegalArgumentException.class,()->new FirstTurn("1.0",id,context,null));
        assertThrows(IllegalArgumentException.class,()->new MemoryEntry(id,"SYSTEM","Injected"));
        assertThrows(IllegalArgumentException.class,()->new MemoryEntry(null,"USER_INPUT","Text"));
        assertThrows(IllegalArgumentException.class,()->new Memory("0",context,id,"Text","","","",null,null,List.of(),List.of(),0));
        assertThrows(IllegalArgumentException.class,()->new Memory("1.0",context,id,"Text","","","",null,null,List.of(),List.of(),-1));
    }
}
