package dev.researchhub.ai.application;

import dev.researchhub.ai.application.ContextContracts.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** A saved numeric context must fail closed when replayed with forged labels, mapping or budget metadata. */
class ComputedContextContractsTest {
    final ObjectMapper json=new ObjectMapper();
    ContextualRequest fixture() throws Exception {
        return json.readValue(Files.readString(Path.of("../contracts/ai/questions/v2/model-request.json")),ContextualRequest.class);
    }
    Summary summary(Summary s,String version,String policy,Budget budget,int bytes,long tokens,List<Binding> bindings) {
        return new Summary(version,policy,budget,s.contextHash(),bytes,tokens,bindings);
    }
    @Test void independentComputedLabelsCannotAliasTextualEvidenceOrSkipExecutionIdentity() throws Exception {
        var s=fixture().context().summary();var source=s.citations().getFirst();var computed=s.citations().getLast();
        var invalid=List.of(
            List.of(source,new Binding("A2",computed.chunkId(),null)),
            List.of(source,new Binding("A1",source.chunkId(),null)),
            List.of(source,new Binding("A1",computed.chunkId(),"S1")),
            List.of(new Binding("S1",source.chunkId(),"S2"),computed));
        for(var bindings:invalid) assertThrows(IllegalArgumentException.class,() -> summary(s,"2.0",s.tokenPolicy(),s.budget(),s.contextBytes(),s.tokenUpperBound(),bindings));
        assertThrows(IllegalArgumentException.class,() -> summary(s,"1.0",s.tokenPolicy(),s.budget(),s.contextBytes(),s.tokenUpperBound(),s.citations()));
        for(String key:Arrays.asList(null,"","[A1]","A13","S0")) assertThrows(IllegalArgumentException.class,() -> new Binding(key,computed.chunkId(),null));
        assertThrows(IllegalArgumentException.class,() -> new Binding("A1",computed.chunkId(),"A1"));
        assertThrows(IllegalArgumentException.class,() -> new Binding("A1","not-an-evidence-hash",null));
    }
    @Test void unsupportedPoliciesAndForgedLimitsCannotMakeOversizedComputedEvidenceAppearSafe() throws Exception {
        var s=fixture().context().summary();
        assertThrows(IllegalArgumentException.class,() -> summary(s,"3.0",s.tokenPolicy(),s.budget(),s.contextBytes(),s.tokenUpperBound(),s.citations()));
        assertThrows(IllegalArgumentException.class,() -> summary(s,"2.0","guessed-words-policy",s.budget(),s.contextBytes(),s.tokenUpperBound(),s.citations()));
        assertThrows(IllegalArgumentException.class,() -> summary(s,"2.0",s.tokenPolicy(),null,s.contextBytes(),s.tokenUpperBound(),s.citations()));
        for(int bytes:List.of(-1,s.budget().maxBytes()+1))
            assertThrows(IllegalArgumentException.class,() -> summary(s,"2.0",s.tokenPolicy(),s.budget(),bytes,s.tokenUpperBound(),s.citations()));
        for(long tokens:List.of(-1L,(long)s.budget().maxTokens()+1))
            assertThrows(IllegalArgumentException.class,() -> summary(s,"2.0",s.tokenPolicy(),s.budget(),s.contextBytes(),tokens,s.citations()));
        assertThrows(IllegalArgumentException.class,() -> new Budget(131073,24576,true));
        assertThrows(IllegalArgumentException.class,() -> new Budget(32768,63,true));
    }
    @Test void aContextEnvelopeCannotDropItsRequestOrSavedEvidenceMapping() throws Exception {
        var f=fixture();
        assertThrows(IllegalArgumentException.class,() -> new ContextualRequest("1.0",f.request(),f.context()));
        assertThrows(IllegalArgumentException.class,() -> new ContextualRequest("2.0",null,f.context()));
        assertThrows(IllegalArgumentException.class,() -> new ContextualRequest("2.0",f.request(),null));
        var s=f.context().summary();
        var swapped=new Summary("2.0",s.tokenPolicy(),s.budget(),s.contextHash(),s.contextBytes(),s.tokenUpperBound(),List.of(s.citations().getLast(),s.citations().getFirst()));
        var wrongOrder=new BuiltContext(swapped,f.context().text());
        assertThrows(IllegalArgumentException.class,() -> new ContextualRequest("2.0",f.request(),wrongOrder));
    }
}
