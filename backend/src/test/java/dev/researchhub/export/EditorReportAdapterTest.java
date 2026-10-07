package dev.researchhub.export;

import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.Report.*;
import dev.researchhub.export.domain.ExportFilename;
import dev.researchhub.export.domain.ExportFormat;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static dev.researchhub.export.ReportFixtures.*;

class EditorReportAdapterTest {
    final EditorReportAdapter adapter=new EditorReportAdapter(JSON);
    final ExportReferences refs=mock(ExportReferences.class);
    dev.researchhub.export.domain.Report convert(String content) { return adapter.convert(W,D,3,"Report",content,NOW,refs,List.of()); }
    String doc(String blocks) { return "{\"type\":\"doc\",\"content\":["+blocks+"]}"; }
    String paragraph(String inline) { return "{\"type\":\"paragraph\",\"content\":["+inline+"]}"; }
    String text(String s) { return "{\"type\":\"text\",\"text\":\""+s+"\"}"; }
    String citation(UUID version,int page) {
        return JSON.writeValueAsString(Map.of("type","researchCitation","attrs",Map.of("citation",JSON.readTree("""
            {"workspaceId":"%s","sourceId":"%s","sourceVersionId":%s,"processingVersion":"extract:2",
             "contentHash":"%s","chunkId":"%s","pageStart":%d,"pageEnd":%d,"sectionTitle":"Results",
             "spans":[{"unitId":"page:3","characterStart":20,"characterEnd":60}]}
            """.formatted(W,S,version==null ? "null" : "\""+version+"\"","c".repeat(64),"b".repeat(64),page,page)) )));
    }
    @Test void convertsAllEditorStructuresAndRetainsFormattingWithoutAnEditorRuntime() {
        var report=convert(doc("""
            {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Methods"}]},
            {"type":"paragraph","content":[{"type":"text","text":"Styled","marks":[{"type":"bold"},{"type":"italic"},{"type":"underline"},{"type":"strike"},{"type":"code"},{"type":"commentAnchor"}]},{"type":"hardBreak"}]},
            {"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph"}]}]},
            {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]},
            {"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph"}]},{"type":"tableCell","content":[{"type":"paragraph"}]}]}]},
            {"type":"figure","content":[{"type":"blockquote","content":[{"type":"paragraph"}]},{"type":"figureCaption","content":[{"type":"text","text":"Figure"}]}]},
            {"type":"codeBlock","content":[{"type":"text","text":"x = 1"}]},{"type":"horizontalRule"}
            """));
        assertEquals(8,report.blocks().size());assertEquals(2,((Heading)report.blocks().getFirst()).level());
        var p=(Paragraph)report.blocks().get(1);assertEquals(EnumSet.allOf(Style.class),((Text)p.content().getFirst()).styles());
        assertEquals("\n",((Text)p.content().get(1)).text());assertEquals(3,((ListBlock)report.blocks().get(2)).start());
        assertTrue(((Paragraph)((Container)report.blocks().get(5)).blocks().get(1)).caption());
        assertEquals(report,JSON.readValue(JSON.writeValueAsString(report),dev.researchhub.export.domain.Report.class));
    }
    @Test void numbersSourcesInFirstOccurrenceOrderButKeepsEachCitationsLocationAndHashes() {
        when(refs.source(eq(S),eq(V),anyString(),any(),any(),any(),any(),any(),anyList())).thenAnswer(call -> {
            var s=source();return new SourceReference(s.sourceId(),s.sourceVersionId(),s.versionNumber(),s.title(),s.sha256(),
                call.getArgument(2),call.getArgument(3),call.getArgument(4),call.getArgument(5),call.getArgument(6),call.getArgument(7),call.getArgument(8));
        });
        var report=convert(doc(paragraph(citation(V,3)+","+citation(V,4))));
        assertEquals(1,report.bibliography().size());
        var refsIn=((Paragraph)report.blocks().getFirst()).content();
        assertEquals(1,((Citation)refsIn.get(1)).number());assertEquals(4,((Citation)refsIn.get(1)).reference().pageStart());
        assertEquals("c".repeat(64),((Citation)refsIn.getFirst()).reference().citedContentHash());
        assertEquals(20,((Citation)refsIn.getFirst()).reference().spans().getFirst().characterStart());
        when(refs.source(eq(S),isNull(),anyString(),any(),any(),any(),any(),any(),anyList())).thenReturn(source());
        assertEquals(1,convert(doc(paragraph(citation(null,3)))).warnings().size());
        assertThrows(ApiException.class,() -> convert(doc(paragraph(citation(V,3).replace(W.toString(),UUID.randomUUID().toString())))));
    }
    @Test void resolvesAnalysisThroughThePortAndAcceptsOnlyEmbeddedRasterImages() {
        UUID analysis=UUID.randomUUID(),execution=UUID.randomUUID();
        when(refs.analysis(analysis,execution,"result","TABLE","Caption")).thenReturn(List.of(new Table(List.of(List.of(cell("result",false))),"Caption",provenance())));
        String block="""
            {"type":"analysisResult","attrs":{"reference":{"analysisId":"%s","executionId":"%s","outputId":"result","renderMode":"TABLE"},"caption":"Caption"}}
            """.formatted(analysis,execution);
        assertInstanceOf(Table.class,convert(doc(block)).blocks().getFirst());
        String image=JSON.writeValueAsString(Map.of("type","image","attrs",Map.of("src","data:image/png;base64,"+Base64.getEncoder().encodeToString(png()),"alt","Chart")));
        assertInstanceOf(Image.class,convert(doc(image)).blocks().getFirst());
        assertThrows(ApiException.class,() -> convert(doc(image.replace("data:image/png;base64,","https://example.com/"))));
        assertThrows(ApiException.class,() -> convert(doc(image.replace(Base64.getEncoder().encodeToString(png()),"broken"))));
    }
    @Test void rejectsUnsupportedAndMalformedTreesInsteadOfSilentlyDroppingContent() {
        for (String input:List.of("{", "[]", "{\"type\":\"other\"}",doc("{\"type\":\"futureNode\"}"),
            "{\"type\":\"doc\",\"content\":{}}",doc("{\"type\":\"heading\",\"attrs\":{\"level\":8}}"),
            doc("{\"type\":\"orderedList\",\"attrs\":{\"start\":0}}"),doc("{\"type\":\"bulletList\",\"content\":[{\"type\":\"paragraph\"}]}"),
            doc(paragraph("{\"type\":\"text\",\"text\":\"x\",\"marks\":[{\"type\":\"link\"}]}")),
            doc(paragraph("{\"type\":\"unsupported\"}")),doc(paragraph("{\"type\":\"text\"}")),
            doc("{\"type\":\"table\",\"content\":[{\"type\":\"paragraph\"}]}"),
            doc("{\"type\":\"table\",\"content\":[{\"type\":\"tableRow\",\"content\":[]}]}") ))
            assertThrows(ApiException.class,() -> convert(input),input);
        String nested="{\"type\":\"paragraph\"}";for(int i=0;i<70;i++) nested="{\"type\":\"blockquote\",\"content\":["+nested+"]}";
        String deep=doc(nested);assertThrows(PayloadTooLargeException.class,() -> convert(deep));
        assertThrows(ApiException.class,() -> convert(doc(paragraph(citation(V,3).replace("\"pageStart\":3","\"pageStart\":0")))));
    }
    @Test void sanitizesTraversalControlCharactersUnicodeAndWindowsReservedNames() {
        assertEquals("report.docx",ExportFilename.of("CON",ExportFormat.DOCX));
        assertEquals("report.pdf",ExportFilename.of("...",ExportFormat.PDF));
        String filename=ExportFilename.of("../../bad\r\nname<>:*?\\\"|",ExportFormat.DOCX);
        assertFalse(filename.matches(".*[\\r\\n/\\\\<>:\"|?*].*"));
        assertEquals("Łódź.pdf",ExportFilename.of("Łódź",ExportFormat.PDF));
        assertTrue(ExportFilename.of("x".repeat(500),ExportFormat.PDF).length()<=104);
        String emoji=ExportFilename.of("x"+"😀".repeat(100),ExportFormat.PDF);
        assertFalse(Character.isHighSurrogate(emoji.charAt(emoji.length()-5)));
    }
}
