package dev.researchhub.document.application;
import dev.researchhub.ai.application.CanvasContracts.*;
import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class CanvasDocumentTargetTest {
    final ObjectMapper json=new ObjectMapper();final CanvasDocumentTarget parser=new CanvasDocumentTarget(json);
    final String id="00000001-0000-4000-8000-000000000001";
    String prose(String text) {return json.writeValueAsString(Map.of("type","doc","content",List.of(Map.of("type","paragraph","attrs",Map.of("blockId",id),"content",List.of(Map.of("type","text","text",text))))));}
    Endpoint at(int offset) {return new Endpoint(id,List.of(0),offset);}
    Target target(Kind kind,int a,int b,String text) {return new Target(kind,at(a),at(b),CanvasDocumentTarget.hash(text));}
    @Test void sharedUnicodeFixtureMatchesJavaUtf16AndHashes() throws Exception {
        var fixture=json.readTree(Files.readString(Path.of("../contracts/ai/canvas/v1/unicode.json")));
        var request=json.treeToValue(fixture.path("capture"),Capture.class);
        var snapshot=parser.capture(json.writeValueAsString(fixture.path("content")),request.target());
        assertEquals(fixture.path("snapshot"),json.valueToTree(snapshot));
        assertEquals("A😀B",snapshot.text());assertEquals("α: ",snapshot.before());
        assertThrows(ApiException.class,()->parser.capture(prose("α: A😀B suffix"),target(Kind.TEXT,5,7,"?")));
    }
    @Test void caretEmptyParagraphAndBoundedSurrogateSafeExcerpts() {
        var caret=parser.capture(prose(""),target(Kind.CARET,0,0,"\0"));assertEquals("",caret.text());
        String text="x".repeat(520)+"😀"+"y".repeat(520);
        var snapshot=parser.capture(prose(text),target(Kind.CARET,522,522,"x".repeat(30)+"😀\0"+"y".repeat(32)));
        assertTrue(snapshot.before().length()<=512);assertTrue(snapshot.after().length()<=512);
        assertThrows(ApiException.class,()->parser.capture(prose("ab"),target(Kind.CARET,0,1,"\0")));
    }
    @Test void nestedListsTablesMultiblockAndAtomsHaveExplicitOffsets() {
        String content="""
            {"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","attrs":{"blockId":"%s"},"content":[{"type":"text","text":"abc"}]}]}]},{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"def"},{"type":"hardBreak"},{"type":"text","text":"g"}]}]}]}]}]}
            """.formatted(id);
        var start=new Endpoint(id,List.of(0,0,0),1);var end=new Endpoint(null,List.of(1,0,0,0),5);
        var result=parser.capture(content,new Target(Kind.TEXT,start,end,CanvasDocumentTarget.hash("bc\ndef\uFFFCg")));
        assertEquals("bc\ndef\uFFFCg",result.text());
        assertThrows(ApiException.class,()->parser.capture(content,new Target(Kind.TEXT,end,start,"a".repeat(64))));
    }
    @Test void sourceAndAnalysisReferencesComeOnlyFromSavedAtoms() {
        String source=UUID.randomUUID().toString(),version=UUID.randomUUID().toString();
        String citation="""
          {"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"%s"},"content":[{"type":"researchCitation","attrs":{"citation":{"sourceId":"%s","sourceVersionId":"%s","chunkId":"%s","processingVersion":"p1"}}}]}]}
          """.formatted(id,source,version,"a".repeat(64));
        var snapshot=parser.capture(citation,target(Kind.SOURCE,0,1,"\uFFFC"));assertEquals(UUID.fromString(source),snapshot.sources().getFirst().sourceId());
        String analysis=UUID.randomUUID().toString(),execution=UUID.randomUUID().toString();
        String content="""
          {"type":"doc","content":[{"type":"analysisResult","attrs":{"blockId":"%s","reference":{"analysisId":"%s","executionId":"%s","outputId":"result"}}}]}
          """.formatted(id,analysis,execution);
        snapshot=parser.capture(content,target(Kind.ANALYSIS,0,1,analysis+":"+execution+":result"));assertEquals("result",snapshot.analyses().getFirst().outputId());
        assertThrows(ApiException.class,()->parser.capture(content,target(Kind.TEXT,0,1,"\uFFFC")));
        assertThrows(ApiException.class,()->parser.capture(citation,target(Kind.ANALYSIS,0,1,"x")));
    }
    @Test void invalidTargetsNeverFallBackAndChangedContentConflicts() {
        assertEquals(ApiErrorCode.CONFLICT,assertThrows(ApiException.class,()->parser.capture(prose("changed"),target(Kind.TEXT,0,3,"old"))).code());
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),new Target(Kind.TEXT,new Endpoint("foreign",List.of(0),0),at(1),"a".repeat(64))));
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),target(Kind.TEXT,2,1,"a")));
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),target(Kind.TEXT,0,0,"")));
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),target(Kind.TEXT,0,4,"abc")));
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),null));
        assertThrows(ApiException.class,()->parser.capture("{}",target(Kind.CARET,0,0,"\0")));
        assertThrows(ApiException.class,()->parser.capture(prose("x".repeat(4001)),target(Kind.TEXT,0,4001,"x".repeat(4001))));
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),new Target(Kind.TEXT,new Endpoint(id,List.of(),0),at(1),CanvasDocumentTarget.hash("a"))));
        assertThrows(ApiException.class,()->parser.capture(prose("abc"),new Target(Kind.TEXT,new Endpoint(id,Arrays.asList((Integer)null),0),at(1),CanvasDocumentTarget.hash("a"))));
    }
}
