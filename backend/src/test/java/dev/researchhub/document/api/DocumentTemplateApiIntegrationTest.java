package dev.researchhub.document.api;

import dev.researchhub.document.infrastructure.BundledDocumentTemplates;
import dev.researchhub.export.application.ExportDispatcher;
import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "researchhub.documents.max-active-per-workspace=2","researchhub.processing.dispatcher.enabled=false",
    "researchhub.ai.canvas.dispatcher.enabled=false","researchhub.analysis.execution.dispatcher.enabled=false",
    "researchhub.export.dispatcher.enabled=false","researchhub.account.erasure.dispatcher.enabled=false"})
@ActiveProfiles("local")
@Import({PostgresTestcontainersConfiguration.class,DocumentTemplateApiIntegrationTest.LocalErasureLedger.class})
class DocumentTemplateApiIntegrationTest {
    @org.springframework.boot.test.context.TestConfiguration static class LocalErasureLedger {
        @org.springframework.context.annotation.Bean @org.springframework.context.annotation.Primary
        dev.researchhub.user.application.ErasureLedger ledger(){return org.mockito.Mockito.mock(dev.researchhub.user.application.ErasureLedger.class);}
    }
    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired ExportDispatcher exports;
    @Autowired BundledDocumentTemplates catalog;
    @Autowired dev.researchhub.user.application.AccountErasureService erasure;
    ApiBrowser owner;String workspace,base;
    @BeforeEach void setup()throws Exception {
        owner=new ApiBrowser(port,json);owner.signUp(UUID.randomUUID()+"@example.test","Template Author");
        workspace=owner.createdWorkspaceId("Template tests","");base="/api/workspaces/"+workspace;
    }
    String request(String id,String locale,UUID nonce) {return json.writeValueAsString(Map.of("clientRequestId",nonce,"templateId",id,"version",1,"locale",locale,"title",catalog.find(id,1,locale).title()));}
    @Test void templateReceiptIsClassifiedExportedAndErasedWithItsPrivateWorkspace()throws Exception {
        assertEquals(201,owner.postJson(base+"/documents/from-template",request("lab-report","pl",UUID.randomUUID())).statusCode());
        var personal=owner.get("/api/account/export");assertEquals(200,personal.statusCode());assertTrue(personal.body().contains("document_template_creations"));
        var deletion=owner.sendWithMethod("DELETE","/api/account","{\"password\":\"correct-horse-battery-staple\"}");assertEquals(202,deletion.statusCode(),deletion.body());
        var receipt=json.readValue(deletion.body(),dev.researchhub.user.application.AccountErasureService.Accepted.class);
        assertTrue(erasure.processNext());assertEquals("SUCCEEDED",erasure.status(receipt.jobId(),receipt.receipt()).status());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM document_template_creations WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
    }
    @Test void allTemplatesInBothLocalesCreateValidatedEditableDocumentsAndExportInEveryFormat()throws Exception {
        for(String locale:List.of("en","pl"))for(String id:BundledDocumentTemplates.IDS) {
            workspace=owner.createdWorkspaceId(id+locale,"");base="/api/workspaces/"+workspace;
            var response=owner.postJson(base+"/documents/from-template",request(id,locale,UUID.randomUUID()));assertEquals(201,response.statusCode(),response.body());
            var created=owner.json(response);String document=created.get("id").asString();
            var content=created.get("content");assertEquals("doc",content.get("type").asString());assertTrue(content.toString().contains("[TODO:"));
            assertFalse(content.toString().contains("researchCitation"));assertFalse(content.toString().contains("analysisResult"));
            for(String format:List.of("DOCX","PDF","LATEX")) {
                var queued=owner.postJson(base+"/documents/"+document+"/exports",json.writeValueAsString(Map.of("format",format,"citationStyle","APA_7","revision",1,"exportLanguage",locale)));
                assertEquals(202,queued.statusCode(),queued.body());String job=owner.json(queued).get("id").asString();
                var snapshot=owner.json(owner.get(base+"/documents/"+document+"/exports/"+job+"/representation"));
                assertEquals(catalog.find(id,1,locale).requiredPlaceholders().size(),snapshot.get("blocks").valueStream().filter(block->"heading".equals(block.path("kind").asString())).count());
                assertEquals(0,snapshot.get("bibliography").size());assertTrue(snapshot.get("origins").toString().contains("BUNDLED_TEMPLATE"));
                assertEquals(locale,snapshot.get("exportLanguage").asString());
                exports.dispatchAvailable();var download=owner.getBytes(base+"/documents/"+document+"/exports/"+job+"/download");
                assertEquals(200,download.statusCode());assertTrue(download.body().length>500);
                assertGoldenStructure(format,download.body(),catalog.find(id,1,locale));
            }
        }
    }
    private void assertGoldenStructure(String format,byte[] bytes,dev.researchhub.document.application.DocumentTemplateContracts.Template template)throws Exception {
        String text;
        if("DOCX".equals(format)) {
            try(var doc=new org.apache.poi.xwpf.usermodel.XWPFDocument(new java.io.ByteArrayInputStream(bytes))) {
                assertEquals(template.requiredPlaceholders().size(),doc.getParagraphs().stream().filter(p->"Heading2".equals(p.getStyle())).count());
                text=doc.getParagraphs().stream().map(org.apache.poi.xwpf.usermodel.XWPFParagraph::getText).collect(java.util.stream.Collectors.joining("\n"));
            }
        } else if("PDF".equals(format)) {
            try(var pdf=org.apache.pdfbox.Loader.loadPDF(bytes)) {assertTrue(pdf.getNumberOfPages()>0);text=new org.apache.pdfbox.text.PDFTextStripper().getText(pdf);}
        } else {
            try(var zip=new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
                text="";for(var entry=zip.getNextEntry();entry!=null;entry=zip.getNextEntry())if("report.tex".equals(entry.getName()))text=new String(zip.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            }
            assertEquals(template.requiredPlaceholders().size(),text.lines().filter(line->line.startsWith("\\subsection*{")).count());
        }
        String normalized=text.replaceAll("\\s+"," ");
        for(var node:template.content().path("content"))if("heading".equals(node.path("type").asString())) {
            String heading=node.path("content").get(0).path("text").asString();assertTrue(normalized.contains(heading),heading+" missing in "+format);
        }
        for(var prompt:template.requiredPlaceholders())assertTrue(text.contains("[TODO:"+prompt.id()+"]"),prompt.id()+" missing in "+format);
        assertFalse(text.contains("researchCitation"));assertFalse(text.contains("AI_GENERATED"));
    }
    @Test void catalogUpgradeNeverChangesAnExistingDocumentOrItsRetriedCreation()throws Exception {
        UUID nonce=UUID.randomUUID();String payload=request("lab-report","en",nonce);
        var before=owner.json(owner.postJson(base+"/documents/from-template",payload));String id=before.path("id").asString();
        Object original=org.springframework.test.util.ReflectionTestUtils.getField(catalog,"bundled");
        @SuppressWarnings("unchecked") var upgraded=new HashMap<>((Map<String,dev.researchhub.document.application.DocumentTemplateContracts.Template>)original);
        var old=catalog.find("lab-report",1,"en");var changed=old.content().deepCopy();
        ((tools.jackson.databind.node.ObjectNode)changed.at("/content/0/content/0")).put("text","Updated guidance only; no generated claims.");
        upgraded.put("lab-report:en",new dev.researchhub.document.application.DocumentTemplateContracts.Template(old.id(),2,"en",old.title(),old.description(),old.requiredPlaceholders(),changed,"b".repeat(64)));
        try {
            org.springframework.test.util.ReflectionTestUtils.setField(catalog,"bundled",Map.copyOf(upgraded));
            assertEquals(before,owner.json(owner.postJson(base+"/documents/from-template",payload)));
            assertEquals(1,owner.json(owner.get(base+"/documents/"+id+"/template-origin")).path("version").asInt());
            var next=owner.postJson(base+"/documents/from-template",json.writeValueAsString(Map.of("clientRequestId",UUID.randomUUID(),"templateId","lab-report","version",2,"locale","en","title","New template version")));
            assertEquals(201,next.statusCode(),next.body());assertTrue(owner.json(next).get("content").toString().contains("Updated guidance only"));
            assertEquals(before.get("content"),owner.json(owner.get(base+"/documents/"+id)).get("content"));
        } finally {org.springframework.test.util.ReflectionTestUtils.setField(catalog,"bundled",original);}
    }
    @Test void explicitAnswerLanguageIsSeparateFromUiAndPartOfRetryIdentity()throws Exception {
        String conversation=owner.json(owner.postJson(base+"/ai/conversations","{\"title\":\"Language choices\"}")).get("id").asString();
        UUID request=UUID.randomUUID();String body=json.writeValueAsString(Map.of("clientRequestId",request,"question","1.25 m","selectedSourceIds",List.of(),"answerLanguage","pl"));
        var answer=owner.postJson(base+"/ai/conversations/"+conversation+"/messages",body);assertEquals(200,answer.statusCode(),answer.body());
        assertTrue(answer.body().contains("nie znaleziono"));
        assertEquals(200,owner.postJson(base+"/ai/conversations/"+conversation+"/messages",body).statusCode());
        assertEquals(409,owner.postJson(base+"/ai/conversations/"+conversation+"/messages",body.replace("\"pl\"","\"en\"")).statusCode());
        assertEquals("pl",jdbc.queryForObject("SELECT answer_language FROM ai_messages WHERE workspace_id=? AND client_request_id=? AND role='USER'",String.class,UUID.fromString(workspace),request));
        assertEquals(400,owner.postJson(base+"/ai/questions","{\"question\":\"1.25\",\"selectedSourceIds\":[],\"answerLanguage\":\"de\"}").statusCode());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
    }
    @Test @org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable(named="DOCUMENT_TEMPLATE_BROWSER_TESTS",matches="true")
    void productionBrowserFlowsAreIsolatedAndAccessibleInBothLocales()throws Exception {
        var builder=new ProcessBuilder("node","e2e/document-templates.cjs").directory(java.nio.file.Path.of("../frontend").toFile());
        builder.environment().put("E2E_BACKEND_URL","http://127.0.0.1:"+port);builder.environment().put("E2E_WORKSPACE_ID",workspace);
        builder.environment().put("E2E_EMAIL",owner.json(owner.get("/api/me")).get("email").asString());
        var log=java.nio.file.Path.of("target/templates-browser-e2e.log");var process=builder.redirectErrorStream(true).redirectOutput(log.toFile()).start();
        long deadline=System.nanoTime()+java.time.Duration.ofSeconds(55).toNanos();
        while(process.isAlive()&&System.nanoTime()<deadline){exports.dispatchAvailable();Thread.sleep(150);}
        if(process.isAlive()){process.destroyForcibly();fail("Template browser exceeded deadline; see "+log);}
        assertEquals(0,process.exitValue(),java.nio.file.Files.readString(log));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM documents WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM ai_generation_runs WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
    }
    @Test void replayDoesNotConsumeCapacityOrOverwriteEditsAndDifferentRequestsConflict()throws Exception {
        UUID nonce=UUID.randomUUID();String payload=request("lab-report","pl",nonce);
        var created=owner.json(owner.postJson(base+"/documents/from-template",payload));String id=created.get("id").asString();
        var origin=owner.json(owner.get(base+"/documents/"+id+"/template-origin"));assertEquals("pl",origin.get("locale").asString());
        assertEquals(201,owner.postJson(base+"/documents","{\"title\":\"Second\",\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}}").statusCode());
        assertEquals(409,owner.postJson(base+"/documents/from-template",request("thesis-chapter","en",UUID.randomUUID())).statusCode());
        var edit=owner.patchJson(base+"/documents/"+id,"{\"title\":\"Author edited structure\",\"revision\":1,\"content\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"My own work\"}]}]}}");assertEquals(200,edit.statusCode(),edit.body());
        var replay=owner.postJson(base+"/documents/from-template",payload);assertEquals(201,replay.statusCode());assertEquals(id,owner.json(replay).get("id").asString());assertEquals("Author edited structure",owner.json(replay).get("title").asString());
        assertEquals(origin,owner.json(owner.get(base+"/documents/"+id+"/template-origin")));
        assertEquals(409,owner.postJson(base+"/documents/from-template",request("thesis-chapter","en",nonce)).statusCode());
        assertEquals(409,owner.postJson(base+"/documents/from-template",request("lab-report","en",UUID.randomUUID()).replace("\"version\":1","\"version\":2")).statusCode());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM documents WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
    }
    @Test void authorizationCsrfForeignWorkspaceAndUnsupportedLocaleAreEnforced()throws Exception {
        var viewer=new ApiBrowser(port,json);viewer.signUp(UUID.randomUUID()+"@example.test","Viewer");
        String email=viewer.json(viewer.get("/api/me")).get("email").asString();
        assertEquals(201,owner.postJson(base+"/members",json.writeValueAsString(Map.of("email",email,"role","VIEWER"))).statusCode());
        String payload=request("lab-report","en",UUID.randomUUID());assertEquals(403,viewer.postJson(base+"/documents/from-template",payload).statusCode());
        assertEquals(403,owner.sendWithoutCsrf("POST",base+"/documents/from-template",payload).statusCode());
        var foreign=new ApiBrowser(port,json);foreign.signUp(UUID.randomUUID()+"@example.test","Foreign");assertEquals(404,foreign.get(base+"/document-templates?locale=en").statusCode());
        assertEquals(400,owner.get(base+"/document-templates?locale=de").statusCode());
        assertEquals(4,viewer.json(viewer.get(base+"/document-templates?locale=pl")).size());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM documents WHERE workspace_id=?",Integer.class,UUID.fromString(workspace)));
    }
}
