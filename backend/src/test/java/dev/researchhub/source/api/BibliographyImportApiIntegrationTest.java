package dev.researchhub.source.api;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.source.application.InMemorySourceStorage;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.support.ApiBrowser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("local")
@TestPropertySource(properties = {
        "researchhub.sources.storage.adapter=in-memory",
        "researchhub.processing.dispatcher.enabled=false",
        "spring.servlet.multipart.max-file-size=3MB",
        "spring.servlet.multipart.max-request-size=4MB"
})
@Import({PostgresTestcontainersConfiguration.class, BibliographyImportApiIntegrationTest.StorageConfiguration.class})
class BibliographyImportApiIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    static class StorageConfiguration {
        @Bean SourceStorage sourceStorage() { return new InMemorySourceStorage(); }
    }

    @Value("${local.server.port}") int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach void clear() { jdbc.execute("TRUNCATE users,workspaces CASCADE"); }

    @Test
    void previewConfirmAndRepeatedFileAreIdempotentAndNeverCreateEvidence() throws Exception {
        var owner = browser();
        owner.signUp("bibliography-owner@example.com", "Owner");
        String workspace = owner.createdWorkspaceId("Bibliography", "Imports");
        String path = imports(workspace);
        byte[] fixture = fixture("generic.bib");

        var previewResponse = owner.postFile(path + "?origin=ZOTERO", "library.bib", "application/x-bibtex", fixture);
        assertEquals(201, previewResponse.statusCode(), previewResponse.body());
        var preview = owner.json(previewResponse);
        assertEquals(4, preview.get("totalRecords").asInt());
        assertEquals(2, preview.get("conflicts").asInt());
        assertEquals(1, preview.get("rejected").asInt());
        assertEquals(1, preview.get("ready").asInt());
        assertEquals(1, preview.get("records").get(0).get("ignoredAttachments").asInt());

        String id = preview.get("id").asString();
        var confirmed = owner.postJson(path + "/" + id + "/confirm", "{\"decisions\":[]}");
        assertEquals(200, confirmed.statusCode(), confirmed.body());
        assertEquals(1, owner.json(confirmed).get("created").asInt());
        assertEquals(2, owner.json(confirmed).get("skipped").asInt());
        assertEquals(1, owner.json(confirmed).get("rejected").asInt());
        assertEquals(1, count("bibliography_items"));
        assertEquals(0, count("source_retrieval_chunks"));

        var repeatedPreview = owner.postFile(path, "renamed.bib", "text/plain", fixture);
        assertEquals(id, owner.json(repeatedPreview).get("id").asString());
        assertEquals("CONFIRMED", owner.json(repeatedPreview).get("status").asString());
        var repeatedConfirm = owner.postJson(path + "/" + id + "/confirm", "{\"decisions\":[]}");
        assertEquals(200, repeatedConfirm.statusCode(), repeatedConfirm.body());
        assertEquals(1, count("bibliography_items"));
        assertEquals(4, count("bibliography_import_records"));
    }

    @Test
    void conflictDoesNotOverwriteSourceUntilExplicitReplaceAndDifferentReplayConflicts() throws Exception {
        var owner = browser();
        owner.signUp("bibliography-source@example.com", "Owner");
        String workspace = owner.createdWorkspaceId("Source bibliography", "Imports");
        String sourcePath = "/api/workspaces/" + workspace + "/sources";
        var uploaded = owner.postFile(sourcePath, "paper.pdf", "application/pdf", "%PDF-1.7\n%%EOF".getBytes());
        String source = owner.json(uploaded).get("id").asString();
        var metadata = owner.sendWithMethod("PUT", sourcePath + "/" + source + "/bibliography", """
                {"title":"Curated title","authors":["Curator, Cora"],"publicationYear":2024,
                 "doi":"10.5555/conflict.1","venue":null,"url":null,"citationKey":"curated"}
                """);
        assertEquals(200, metadata.statusCode(), metadata.body());
        byte[] conflicting = """
                @article{imported,title={Imported title},author={Importer, Ida},year={2025},doi={10.5555/conflict.1}}
                """.getBytes(StandardCharsets.UTF_8);
        String importPath = imports(workspace);
        var previewResponse = owner.postFile(importPath, "conflict.bib", "text/plain", conflicting);
        var preview = owner.json(previewResponse);
        assertEquals("CONFLICT", preview.get("records").get(0).get("status").asString());
        assertEquals("Curated title", owner.json(owner.get(sourcePath + "/" + source)).get("bibliography").get("title").asString());

        String importId = preview.get("id").asString();
        var replace = owner.postJson(importPath + "/" + importId + "/confirm", """
                {"decisions":[{"recordNumber":1,"action":"REPLACE_SOURCE","targetId":"%s"}]}
                """.formatted(source));
        assertEquals(200, replace.statusCode(), replace.body());
        assertEquals(1, owner.json(replace).get("updated").asInt());
        assertEquals("Imported title", owner.json(owner.get(sourcePath + "/" + source)).get("bibliography").get("title").asString());

        var changedReplay = owner.postJson(importPath + "/" + importId + "/confirm", "{\"decisions\":[]}");
        assertEquals(409, changedReplay.statusCode(), changedReplay.body());
    }

    @Test
    void cancelAuthorizationAndLimitsFailClosedWithoutMetadata() throws Exception {
        var owner = browser();
        owner.signUp("bibliography-security@example.com", "Owner");
        String workspace = owner.createdWorkspaceId("Security", "Imports");
        var viewer = browser();
        viewer.signUp("bibliography-viewer@example.com", "Viewer");
        assertEquals(201, owner.postJson("/api/workspaces/" + workspace + "/members", """
                {"email":"bibliography-viewer@example.com","role":"VIEWER"}
                """).statusCode());
        byte[] ris = fixture("mendeley-export.ris");
        assertEquals(403, viewer.postFile(imports(workspace), "library.ris", "text/plain", ris).statusCode());

        var preview = owner.postFile(imports(workspace), "library.ris", "text/plain", ris);
        String id = owner.json(preview).get("id").asString();
        assertEquals(204, owner.delete(imports(workspace) + "/" + id).statusCode());
        assertEquals(409, owner.postJson(imports(workspace) + "/" + id + "/confirm", "{\"decisions\":[]}").statusCode());
        assertEquals(0, count("bibliography_items"));

        byte[] tooLarge = new byte[2 * 1024 * 1024 + 1];
        java.util.Arrays.fill(tooLarge, (byte) 'x');
        var oversized = owner.postFile(imports(workspace), "huge.bib", "text/plain", tooLarge);
        assertEquals(413, oversized.statusCode(), oversized.body());
        assertEquals(0, count("bibliography_items"));
    }

    private ApiBrowser browser() { return new ApiBrowser(port, json); }
    private static String imports(String workspace) { return "/api/workspaces/" + workspace + "/bibliography/imports"; }
    private int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
    private static byte[] fixture(String name) throws Exception {
        return Files.readAllBytes(Path.of("..", "contracts", "bibliography", "fixtures", name));
    }

    @Test void zoteroAndMendeleyAdaptersPreserveCollectionsAndCuratedChangesAcrossRepeatedImports() throws Exception {
        var owner=browser();owner.signUp("adapter-owner@example.com","Owner");String workspace=owner.createdWorkspaceId("Adapters","File migration");
        for(String name:java.util.List.of("zotero-export.json","zotero-export.bib","mendeley-export.ris")) {
            var p=owner.postFile(imports(workspace)+"?origin="+(name.startsWith("zotero")?"ZOTERO":"MENDELEY"),name,"text/plain",fixture(name));
            assertEquals(201,p.statusCode(),p.body());String id=owner.json(p).path("id").asString();
            assertEquals(200,owner.postJson(imports(workspace)+"/"+id+"/confirm","{\"decisions\":[]}").statusCode());
        }
        var library=owner.get("/api/workspaces/"+workspace+"/bibliography/items");assertEquals(200,library.statusCode(),library.body());
        assertEquals(5,owner.json(library).path("items").size());
        var chosen=owner.json(library).path("items").valueStream().filter(i->"zotero2026".equals(i.path("bibliography").path("citationKey").asString())).findFirst().orElseThrow();
        assertEquals("systematic review",chosen.path("collections").get(0).asString());
        String itemId=chosen.path("id").asString();var body=json.createObjectNode();
        body.set("bibliography",chosen.path("bibliography").deepCopy());((tools.jackson.databind.node.ObjectNode)body.path("bibliography")).put("title","User-curated title");
        body.set("tags",chosen.path("tags"));body.set("collections",chosen.path("collections"));body.put("expectedUpdatedAt",chosen.path("updatedAt").asString());
        String itemPath="/api/workspaces/"+workspace+"/bibliography/items/"+itemId;
        assertEquals(204,owner.sendWithMethod("PUT",itemPath,json.writeValueAsString(body)).statusCode());
        assertEquals(409,owner.sendWithMethod("PUT",itemPath,json.writeValueAsString(body)).statusCode());
        byte[] changedFile=(new String(fixture("zotero-export.json"),StandardCharsets.UTF_8)+"\n").getBytes(StandardCharsets.UTF_8);
        var fresh=owner.postFile(imports(workspace)+"?origin=ZOTERO","zotero-export.json","application/json",changedFile);
        assertEquals(1,owner.json(fresh).path("conflicts").asInt());
        String freshId=owner.json(fresh).path("id").asString();
        assertEquals(200,owner.postJson(imports(workspace)+"/"+freshId+"/confirm","{\"decisions\":[]}").statusCode());
        assertEquals("User-curated title",jdbc.queryForObject("SELECT bibliography->>'title' FROM bibliography_items WHERE id=?",String.class,java.util.UUID.fromString(itemId)));
        assertEquals(5,count("bibliography_items"));assertEquals(0,count("source_retrieval_chunks"));
    }

    @Test void invalidDecisionsChangedSourcesAndForeignTargetsCannotOverwriteMetadata() throws Exception {
        var owner=browser();owner.signUp("import-fence@example.com","Owner");String workspace=owner.createdWorkspaceId("Fenced","Imports");
        var source=owner.postFile("/api/workspaces/"+workspace+"/sources","paper.txt","text/plain","Example".getBytes());
        String sourceId=owner.json(source).path("id").asString(),sourcePath="/api/workspaces/"+workspace+"/sources/"+sourceId;
        String metadata="""
          {"title":"Old title","authors":[],"publicationYear":null,"doi":"10.5555/fenced","venue":null,"url":null,"citationKey":"old"}
          """;
        assertEquals(200,owner.sendWithMethod("PUT",sourcePath+"/bibliography",metadata).statusCode());
        var preview=owner.postFile(imports(workspace),"fence.bib","text/plain","@book{new,title={Proposed},doi={10.5555/fenced}}".getBytes());
        String path=imports(workspace)+"/"+owner.json(preview).path("id").asString()+"/confirm";
        assertEquals(400,owner.postJson(path,"{\"decisions\":[{\"recordNumber\":999,\"action\":\"SKIP\"}]}").statusCode());
        assertEquals(400,owner.postJson(path,"{\"decisions\":[{\"recordNumber\":1,\"action\":\"REPLACE_SOURCE\"}]}").statusCode());
        assertEquals(200,owner.sendWithMethod("PUT",sourcePath+"/bibliography",metadata.replace("Old title","Changed after preview")).statusCode());
        assertEquals(409,owner.postJson(path,"""
          {"decisions":[{"recordNumber":1,"action":"REPLACE_SOURCE","targetId":"%s"}]}
          """.formatted(sourceId)).statusCode());
        String foreign=owner.createdWorkspaceId("Foreign","Other workspace");
        var foreignSource=owner.postFile("/api/workspaces/"+foreign+"/sources","other.txt","text/plain","Other".getBytes());
        assertEquals(404,owner.postJson(path,"""
          {"decisions":[{"recordNumber":1,"action":"LINK_SOURCE","targetId":"%s"}]}
          """.formatted(owner.json(foreignSource).path("id").asString())).statusCode());
        assertEquals("Changed after preview",owner.json(owner.get(sourcePath)).path("bibliography").path("title").asString());
        assertEquals(0,count("bibliography_import_records"));
    }

    @Test void maliciousLatexHtmlAndAttachmentAddressesCauseNoNetworkOrFileReads() throws Exception {
        var requests=new java.util.concurrent.atomic.AtomicInteger();
        var endpoint=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        endpoint.createContext("/attachment",exchange->{requests.incrementAndGet();exchange.sendResponseHeaders(204,-1);exchange.close();});endpoint.start();
        var attachment=java.nio.file.Files.createTempFile("synthetic-bibliography-", ".txt");java.nio.file.Files.writeString(attachment,"SYNTHETIC_PRIVATE_CONTENT");
        try {
            var owner=browser();owner.signUp("inert-import@example.com","Owner");String workspace=owner.createdWorkspaceId("Inert","Security fixture");
            String url="http://127.0.0.1:"+endpoint.getAddress().getPort()+"/attachment";
            String bib="@article{inert,title={\\input{"+attachment+"} <img src=x onerror=alert(1)>},url={"+url+"},file={"+attachment+"}}";
            var preview=owner.postFile(imports(workspace),"inert.bib","text/plain",bib.getBytes(StandardCharsets.UTF_8));
            assertEquals(201,preview.statusCode(),preview.body());assertEquals(1,owner.json(preview).path("ready").asInt());
            assertFalse(preview.body().contains("SYNTHETIC_PRIVATE_CONTENT"));String id=owner.json(preview).path("id").asString();
            assertEquals(200,owner.postJson(imports(workspace)+"/"+id+"/confirm","{\"decisions\":[]}").statusCode());assertEquals(0,requests.get());
            assertEquals(0,count("sources"));assertEquals(0,count("source_retrieval_chunks"));
        }finally{endpoint.stop(0);java.nio.file.Files.deleteIfExists(attachment);}
    }
}
