package dev.researchhub.ai.application;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import dev.researchhub.ai.application.AuthoringContracts.*;
import static org.junit.jupiter.api.Assertions.*;

class AuthoringContractTest {
    private final ObjectMapper json=new ObjectMapper();
    @Test void javaAndPythonReadTheSameVersionedAuthoringFixtures() throws Exception {
        var folder=Path.of("../contracts/ai/authoring/v1");
        var feature=new AuthoringFeature(1024,"0");
        for (String name:List.of("draft","rewrite")) {
            var request=json.readValue(Files.readString(folder.resolve(name+"-model-request.json")),ContextContracts.ContextualRequest.class);
            var result=json.readValue(Files.readString(folder.resolve(name+"-model-result.json")),AuthoringContracts.Result.class);
            Kind kind=Kind.valueOf(name.toUpperCase(Locale.ROOT)); result.validateFor(request.request(),kind,kind==Kind.DRAFT);
            assertEquals(feature.policy(kind).systemInstruction(),request.request().systemInstruction());
            assertEquals(feature.policy(kind).templateHash(),request.request().templateHash());
            assertEquals(feature.policy(kind).parameters(),request.request().parameters());
            var evidence=request.request().evidence();
            var forged=new AuthoringContracts.Result(result.schemaVersion(),UUID.randomUUID(),result.templateId(),result.templateHash(),result.model(),result.usage(),result.providerRequestId(),result.answer());
            assertThrows(IllegalArgumentException.class,() -> forged.validateFor(request.request(),kind,false));
        }
        assertNull(new AuthoringFeature(4096,"none").policy(Kind.REWRITE).parameters().temperature());
    }
    @Test void rejectsInvalidPublicInputsAndModelReferences() {
        UUID source=UUID.randomUUID();
        assertThrows(IllegalArgumentException.class,() -> new Command(Kind.DRAFT,1,0,null,null,null,"Theory",List.of(),300,"ACADEMIC",true));
        assertThrows(IllegalArgumentException.class,() -> new Command(Kind.DRAFT,1,0,null,null,null,"Theory",List.of(source,source),300,"ACADEMIC",true));
        assertThrows(IllegalArgumentException.class,() -> new Command(Kind.REWRITE,1,null,1,4,Action.CLARIFY,"Rewrite",List.of(source),300,"ACADEMIC",false));
        assertThrows(IllegalArgumentException.class,() -> new Command(Kind.REWRITE,1,null,1,4,Action.CLARIFY,"Rewrite",null,300,"ACADEMIC",false));
        assertThrows(IllegalArgumentException.class,() -> new Accept(0,null,null));
        assertThrows(IllegalArgumentException.class,() -> new Accept(1," ",null));
        assertThrows(IllegalArgumentException.class,() -> new Match("a".repeat(64),Category.related,Double.NaN,"Context"));
        assertThrows(IllegalArgumentException.class,() -> new AuthoringContracts.Answer("INSUFFICIENT_EVIDENCE","Invented",List.of(),List.of()));
    }
}
