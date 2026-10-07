package dev.researchhub.export;

import dev.researchhub.export.application.*;
import dev.researchhub.export.domain.*;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.SourceRowFixture;
import dev.researchhub.support.ApiBrowser;
import java.util.*;
import java.time.*;
import java.io.*;
import java.nio.file.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties={"researchhub.processing.dispatcher.enabled=false","researchhub.analysis.execution.dispatcher.enabled=false","researchhub.export.dispatcher.enabled=false"})
@Import(PostgresTestcontainersConfiguration.class)
class ExportApiIntegrationTest {
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired ExportStore store;
    @Autowired ExportDispatcher dispatcher;
    ApiBrowser owner,viewer,outsider;
    UUID workspace,document,user,source,version;
    String path;
    @BeforeEach void setup() throws Exception {
        jdbc.execute("TRUNCATE users,workspaces CASCADE");
        owner=new ApiBrowser(port,json);user=UUID.fromString(owner.signUp("export-owner@example.com","Anna"));
        workspace=UUID.fromString(owner.createdWorkspaceId("Export research",""));
        viewer=new ApiBrowser(port,json);viewer.signUp("export-viewer@example.com","Reader");
        assertEquals(201,owner.postJson("/api/workspaces/"+workspace+"/members","{\"email\":\"export-viewer@example.com\",\"role\":\"VIEWER\"}").statusCode());
        outsider=new ApiBrowser(port,json);outsider.signUp("export-outsider@example.com","Outside");
        source=UUID.randomUUID();version=SourceRowFixture.insertReadyText(jdbc,source,workspace,user,"Kowalski — Research notes");
        var created=owner.postJson("/api/workspaces/"+workspace+"/documents",json.writeValueAsString(Map.of("title","Raport Łódź / final","content",json.readTree(content()))));
        assertEquals(201,created.statusCode(),created.body());document=UUID.fromString(owner.json(created).path("id").asString());
        path="/api/workspaces/"+workspace+"/documents/"+document+"/exports";
    }
    String content() { return """
        {"type":"doc","content":[
            {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Methods"}]},
            {"type":"paragraph","attrs":{"blockId":"%s"},"content":[{"type":"text","text":"Zażółć gęślą jaźń"},
                {"type":"researchCitation","attrs":{"citation":{"workspaceId":"%s","sourceId":"%s","sourceVersionId":"%s",
                "processingVersion":"extract:2","contentHash":"%s","chunkId":"%s","pageStart":3,"pageEnd":3,
                "sectionTitle":"Methods","spans":[{"unitId":"page:3","characterStart":0,"characterEnd":20}]}}}]},
            {"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Measurement"}]}]}]},
            {"type":"figure","content":[{"type":"table","content":[{"type":"tableRow","content":[
                {"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Value"}]}]}]},
                {"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"42"}]}]}]}]},
                {"type":"figureCaption","content":[{"type":"text","text":"Table 1. Measurements"}]}]}]}
        """.formatted(UUID.randomUUID(),workspace,source,version,"a".repeat(64),"b".repeat(64)); }
    UUID enqueue(ApiBrowser browser,String format) throws Exception {
        var created=browser.postJson(path,"{\"format\":\""+format+"\",\"revision\":1}");
        assertEquals(202,created.statusCode(),created.body());assertEquals("no-store",created.headers().firstValue("Cache-Control").orElseThrow());
        UUID id=UUID.fromString(browser.json(created).path("id").asString());assertTrue(created.headers().firstValue("Location").orElseThrow().endsWith(id.toString()));return id;
    }
    @Test void fullHttpFlowExportsAllFormatsFromAFrozenRevisionAndViewerCanExport() throws Exception {
        for(String format:List.of("DOCX","PDF","LATEX")) {
            UUID job=enqueue(viewer,format);
            assertEquals(409,viewer.get(path+"/"+job+"/download").statusCode());
            var representation=viewer.json(viewer.get(path+"/"+job+"/representation"));
            assertEquals("1.0",representation.path("schemaVersion").asString());assertEquals(version.toString(),representation.path("bibliography").get(0).path("source").path("sourceVersionId").asString());
            assertEquals(1,representation.path("origins").size());
            dispatcher.dispatchAvailable();var ready=viewer.get(path+"/"+job);assertEquals("SUCCEEDED",viewer.json(ready).path("status").asString(),ready.body());
            var download=viewer.getBytes(path+"/"+job+"/download");assertEquals(200,download.statusCode());
            assertEquals(ExportFormat.valueOf(format).mediaType(),download.headers().firstValue("Content-Type").orElseThrow());
            assertTrue(viewer.json(ready).path("filename").asString().endsWith("."+ExportFormat.valueOf(format).extension()));
            assertTrue(download.headers().firstValue("Content-Disposition").orElseThrow().contains("filename*="));
            assertEquals("no-store",download.headers().firstValue("Cache-Control").orElseThrow());
            if(format.equals("DOCX")) try(var word=new XWPFDocument(new ByteArrayInputStream(download.body()))) { assertEquals(1,word.getTables().size());assertFalse(word.getParagraphs().isEmpty()); }
            else if(format.equals("PDF")) try(var pdf=Loader.loadPDF(download.body())) { String text=new PDFTextStripper().getText(pdf);assertTrue(text.contains("Zażółć gęślą jaźń"));assertTrue(text.contains("[1, p. 3]"));assertTrue(text.contains("References")); }
            else {
                var files=LatexReportRenderingTest.unzip(download.body());
                assertTrue(LatexReportRenderingTest.tex(files).contains("Zażółć gęślą jaźń"));
                assertTrue(LatexReportRenderingTest.tex(files).contains("[1, p. 3]"));
                assertEquals(representation,json.readTree(files.get("report.json")));
                assertEquals("HUMAN",json.readTree(files.get("report.json")).path("origins").get(0).path("category").asString());
            }
            assertEquals(404,outsider.get(path+"/"+job).statusCode());assertEquals(404,outsider.get(path+"/"+job+"/download").statusCode());assertEquals(404,outsider.get(path+"/"+job+"/representation").statusCode());
            assertEquals(404,owner.get(path.replace(document.toString(),UUID.randomUUID().toString())+"/"+job).statusCode());
        }
    }
    @Test void rejectsAnonymousCsrfStaleAndMalformedRequestsAndBoundsTheWorkspaceQueue() throws Exception {
        assertEquals(401,new ApiBrowser(port,json).get(path+"/"+UUID.randomUUID()).statusCode());
        assertEquals(403,owner.sendWithoutCsrf("POST",path,"{\"format\":\"PDF\",\"revision\":1}").statusCode());
        assertEquals(404,outsider.postJson(path,"{\"format\":\"PDF\",\"revision\":1}").statusCode());
        for(String input:List.of("{\"format\":\"HTML\",\"revision\":1}","{\"format\":null,\"revision\":1}","{\"format\":\"PDF\",\"revision\":0}")) assertEquals(400,owner.postJson(path,input).statusCode());
        assertEquals(409,owner.postJson(path,"{\"format\":\"PDF\",\"revision\":2}").statusCode());
        assertEquals(404,owner.get(path+"/"+UUID.randomUUID()).statusCode());
        for(int i=0;i<4;i++) enqueue(owner,"PDF");
        assertEquals(409,owner.postJson(path,"{\"format\":\"PDF\",\"revision\":1}").statusCode());
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM report_exports",Integer.class));
    }
    @Test void persistentQueueRecoversStaleClaimsExpiresBytesAndProtectsPublishedSnapshots() throws Exception {
        UUID id=enqueue(owner,"PDF");Instant now=Instant.now();
        var claimed=store.claim(now).orElseThrow();
        assertEquals(id,claimed.job().id());
        store.maintain(now.plusSeconds(1),now.plusSeconds(701));
        assertEquals(ExportJob.Status.FAILED,store.find(workspace,document,id).status());
        store.complete(id,new byte[]{1},null,now.plusSeconds(702));
        assertEquals(ExportJob.Status.FAILED,store.find(workspace,document,id).status());
        assertEquals(409,owner.get(path+"/"+id+"/download").statusCode());
        assertThrows(org.springframework.dao.DataAccessException.class,() -> jdbc.update("UPDATE report_exports SET snapshot='{}' WHERE id=?",id));
        store.maintain(now.plus(Duration.ofDays(8)),now.plus(Duration.ofDays(8)));
        assertEquals(ExportJob.Status.EXPIRED,store.find(workspace,document,id).status());
        assertEquals(409,owner.get(path+"/"+id+"/representation").statusCode());
        assertEquals(409,owner.get(path+"/"+id+"/download").statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM report_exports WHERE content IS NOT NULL OR snapshot IS NOT NULL",Integer.class));
        assertTrue(store.claim(now.plus(Duration.ofDays(8))).isEmpty());
    }
    @Test void savedSnapshotIsUnchangedWhenTheDocumentAndSourceAreUpdated() throws Exception {
        UUID id=enqueue(owner,"LATEX");var before=owner.get(path+"/"+id+"/representation").body();
        assertEquals(200,owner.patchJson(path.replace("/exports",""),"{\"title\":\"Changed\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]},\"revision\":1}").statusCode());
        SourceRowFixture.addVersion(jdbc,source,2,"new.txt","text/plain","TXT",20,"sources/"+UUID.randomUUID(),"e".repeat(64),"READY",Instant.now());
        assertEquals(before,owner.get(path+"/"+id+"/representation").body());
        dispatcher.dispatchAvailable();var download=owner.getBytes(path+"/"+id+"/download");assertEquals(200,download.statusCode());
        assertEquals(json.readTree(before),json.readTree(LatexReportRenderingTest.unzip(download.body()).get("report.json")));
    }
    @Test @EnabledIfEnvironmentVariable(named="EXPORT_BROWSER_TESTS",matches="true")
    void productionBrowserCanGenerateAndDownloadAllFormats() throws Exception {
        var builder=new ProcessBuilder("node","e2e/export.cjs").directory(Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL","http://127.0.0.1:"+port);
        builder.environment().put("E2E_WORKSPACE_ID",workspace.toString());builder.environment().put("E2E_DOCUMENT_ID",document.toString());
        var log=Path.of("target/export-browser-e2e.log");var process=builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
        long deadline=System.nanoTime()+Duration.ofSeconds(55).toNanos();
        while(process.isAlive() && System.nanoTime()<deadline) { dispatcher.dispatchAvailable();Thread.sleep(150); }
        if(process.isAlive()) { process.destroyForcibly();fail("Browser export exceeded deadline"); }
        assertEquals(0,process.exitValue(),Files.readString(log));
        var files=LatexReportRenderingTest.unzip(Files.readAllBytes(Path.of("target/export-qa/browser-report.zip")));
        assertTrue(LatexReportRenderingTest.tex(files).contains("\\section*{Methods}"));
        assertEquals(document.toString(),json.readTree(files.get("report.json")).path("documentId").asString());
    }
}
