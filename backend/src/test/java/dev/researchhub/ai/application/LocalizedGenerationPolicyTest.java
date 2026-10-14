package dev.researchhub.ai.application;

import dev.researchhub.shared.localization.ContentLanguage;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class LocalizedGenerationPolicyTest {
    @Test void explicitLanguageIsHashedBudgetedAndDoesNotAlterEvidence() throws Exception {
        var base=new QuestionFeature(6,"0",1024);
        assertSame(base,LocalizedGenerationPolicy.of(base,null));
        for(var language:ContentLanguage.values()) {
            var policy=LocalizedGenerationPolicy.of(base,language);
            assertEquals(base.parameters(),policy.parameters());
            assertEquals(base.templateId(),policy.templateId());
            assertEquals(RetrievalIdentity.hash(policy.systemInstruction()),policy.templateHash());
            assertNotEquals(base.templateHash(),policy.templateHash());
            assertTrue(policy.systemInstruction().contains(language==ContentLanguage.PL ? "in Polish" : "in English"));
            assertTrue(policy.systemInstruction().contains("scientific values unchanged"));
            var template=LocalizedGenerationPolicy.template("edit:2","Evidence only",base.parameters(),language);
            assertEquals("edit:2",template.templateId());assertEquals(base.parameters(),template.parameters());
            assertEquals(RetrievalIdentity.hash(template.systemInstruction()),template.templateHash());
            assertEquals(language==ContentLanguage.PL?"pl-PL":"en-US",language.locale());
            assertEquals(language,new ObjectMapper().readValue("\""+language.code()+"\"",ContentLanguage.class));
            var request=new ConversationContracts.Send(UUID.randomUUID(),"1.25 m",List.of(),List.of(),language);
            assertEquals(language,request.asQuestion().answerLanguage());assertEquals("1.25 m",request.asQuestion().question());
            assertFalse(WorkspaceQuestionService.noEvidence(language).isBlank());assertFalse(WorkspaceQuestionService.insufficient(language).isBlank());
        }
        var legacy=LocalizedGenerationPolicy.template("legacy","Original",base.parameters(),null);
        assertEquals("legacy",legacy.templateId());assertEquals("Original",legacy.systemInstruction());assertEquals(RetrievalIdentity.hash("Original"),legacy.templateHash());
        assertEquals(WorkspaceQuestionService.NO_EVIDENCE,WorkspaceQuestionService.noEvidence(null));
        assertEquals(WorkspaceQuestionService.INSUFFICIENT,WorkspaceQuestionService.insufficient(null));
        for(String bad:Arrays.asList(null,"de","PL","","en-US"))assertThrows(IllegalArgumentException.class,()->ContentLanguage.from(bad));
    }
}
