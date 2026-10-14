package dev.researchhub.document.application;

import dev.researchhub.document.infrastructure.BundledDocumentTemplates;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class DocumentTemplateCatalogTest {
    final ObjectMapper json=new ObjectMapper();
    final BundledDocumentTemplates catalog=new BundledDocumentTemplates(json);
    @Test void allFourTemplatesHaveBothLocalesGuidanceAndNormalEditorNodes() {
        for(String locale:List.of("en","pl")) {
            var templates=catalog.list(locale);assertEquals(4,templates.size());
            for(var t:templates) {
                assertEquals(locale,t.locale());assertEquals(1,t.version());assertEquals(64,t.sha256().length());
                assertEquals("doc",t.content().path("type").asString());assertFalse(t.requiredPlaceholders().isEmpty());
                assertFalse(t.content().toString().contains("researchCitation"));assertFalse(t.content().toString().contains("analysisResult"));
                var document=json.readTree(catalog.instantiate(t,UUID.randomUUID()));
                assertTrue(document.toString().contains("blockId"));assertTrue(document.toString().contains("IMPORTED"));
                assertFalse(document.toString().contains("AI_GENERATED"));
                ((ObjectNode)t.content()).put("type","changed");assertEquals("doc",catalog.find(t.id(),1,locale).content().path("type").asString());
            }
        }
    }
    @Test void unknownLocaleIdentityAndVersionAreExplicitErrors() {
        for(String bad:Arrays.asList(null,"","de","PL"))assertThrows(ApiException.class,()->catalog.list(bad));
        assertThrows(ResourceNotFoundException.class,()->catalog.find("unknown",1,"en"));
        assertThrows(ConflictException.class,()->catalog.find("lab-report",2,"en"));
    }
    ObjectNode manifest() {
        var t=catalog.find("lab-report",1,"en");var root=(ObjectNode)json.valueToTree(t);root.remove("sha256");return root;
    }
    @Test void malformedManifestPromptsAndUnsafeNodesCannotBeBundled() {
        var bad=manifest();bad.put("id","../file");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(bad));
        var missing=manifest();missing.putArray("requiredPlaceholders");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(missing));
        var prompt=manifest();((ObjectNode)prompt.path("requiredPlaceholders").get(0)).put("id","not-in-body");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(prompt));
        for(String type:List.of("researchCitation","analysisResult","image","script")) {
            var resource=manifest();((ObjectNode)resource.at("/content/content/0")).put("type",type);
            assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(resource));
        }
        var attrs=manifest();((ObjectNode)attrs.at("/content/content/1/attrs")).put("src","https://example.invalid");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(attrs));
        var level=manifest();((ObjectNode)level.at("/content/content/1/attrs")).put("level",7);assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(level));
        var marks=manifest();((ObjectNode)marks.at("/content/content/0/content/0/marks/0")).put("type","link");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(marks));
        var text=manifest();((ObjectNode)text.at("/content/content/0/content/0")).put("text","");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(text));
    }
    @Test void everyManifestFieldAndResourceBoundaryIsValidated() {
        for(var root:List.of(json.createArrayNode(),json.nullNode()))assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(root));
        for(String field:List.of("id","version","locale","title","description","requiredPlaceholders","content")) {
            var root=manifest();root.remove(field);assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(root),field);
        }
        var zero=manifest();zero.put("version",0);assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(zero));
        var locale=manifest();locale.put("locale","de");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(locale));
        var invalidType=manifest();((ObjectNode)invalidType.path("content")).put("type","paragraph");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(invalidType));
        var notArray=manifest();notArray.putObject("requiredPlaceholders");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(notArray));
        for(String field:List.of("id","hint")) {var root=manifest();((ObjectNode)root.path("requiredPlaceholders").get(0)).put(field,"");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(root));}
        var duplicate=manifest();((tools.jackson.databind.node.ArrayNode)duplicate.path("requiredPlaceholders")).add(duplicate.path("requiredPlaceholders").get(0).deepCopy());assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(duplicate));
        var children=manifest();((ObjectNode)children.path("content")).putObject("content");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(children));
        var noText=manifest();((ObjectNode)noText.at("/content/content/0/content/0")).remove("text");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(noText));
        var lowLevel=manifest();((ObjectNode)lowLevel.at("/content/content/1/attrs")).put("level",0);assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(lowLevel));
        var wide=manifest();var wideChildren=(tools.jackson.databind.node.ArrayNode)wide.at("/content/content");for(int i=0;i<2001;i++)wideChildren.addObject().put("type","paragraph");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(wide));
        var deep=manifest();ObjectNode parent=(ObjectNode)deep.path("content");for(int i=0;i<34;i++)parent=parent.withArray("content").addObject().put("type","blockquote");assertThrows(IllegalArgumentException.class,()->BundledDocumentTemplates.validate(deep));
    }
}
