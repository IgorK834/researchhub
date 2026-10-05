package dev.researchhub.analysis.api;

import dev.researchhub.BackendApplication;
import dev.researchhub.analysis.application.ExecutionOutputValidator;
import dev.researchhub.analysis.application.AnalysisExecutionDispatcher;
import dev.researchhub.source.SourceRowFixture;
import dev.researchhub.source.application.SourceStorage;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.support.ApiBrowser;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Real application stop/start against the same PostgreSQL; no Java object, worker or chart cache survives. */
class AnalysisRestartIntegrationTest {
    ConfigurableApplicationContext start(PostgreSQLContainer database) {
        return new SpringApplicationBuilder(BackendApplication.class,AnalysisApiIntegrationTest.Configuration.class)
            .profiles("local").run("--server.port=0","--spring.datasource.url="+database.getJdbcUrl(),
                "--spring.datasource.username="+database.getUsername(),"--spring.datasource.password="+database.getPassword(),
                "--researchhub.sources.storage.adapter=in-memory","--researchhub.processing.dispatcher.enabled=false",
                "--researchhub.analysis.execution.dispatcher.enabled=false","--researchhub.analysis.sandbox.enabled=false");
    }
    ApiBrowser browser(ConfigurableApplicationContext app) {
        return new ApiBrowser(app.getEnvironment().getRequiredProperty("local.server.port",Integer.class),app.getBean(ObjectMapper.class));
    }
    @Test void successfulRecordAndChartSurviveFullApplicationRestartWithoutReadingNewDataOrRunningCode() throws Exception {
        try (var database=new PostgreSQLContainer(DockerImageName.parse("pgvector/pgvector:0.8.2-pg17-bookworm").asCompatibleSubstituteFor("postgres"))) {
            database.start();String endpoint,artifactEndpoint,before,provenanceBefore,codeBefore;
            byte[] svg="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\"><path d=\"M10 90L190 10\" stroke=\"black\"/></svg>".getBytes(StandardCharsets.UTF_8);
            try (var first=start(database)) {
                var json=first.getBean(ObjectMapper.class);var jdbc=first.getBean(JdbcTemplate.class);var owner=browser(first);
                UUID user=UUID.fromString(owner.signUp("restart@example.test","Researcher"));
                String workspace=owner.createdWorkspaceId("Lab","Restart verification");UUID source=UUID.randomUUID();
                byte[] data="Frequency,Resistance\n100,2\n".getBytes(StandardCharsets.UTF_8);String hash=ExecutionOutputValidator.sha256(data);
                first.getBean(SourceStorage.class).store(new StorageKey("sources/"+source),new ByteArrayInputStream(data),"text/csv");
                UUID version=SourceRowFixture.insert(jdbc,source,UUID.fromString(workspace),user,"measurements.csv","measurements.csv","text/csv","CSV",data.length,"sources/"+source,hash,"READY",null,Instant.now());
                UUID job=UUID.randomUUID();jdbc.update("INSERT INTO processing_jobs(id,workspace_id,job_type,resource_type,resource_id,status,attempt_count,created_at,started_at,finished_at) VALUES (?,?,'SOURCE_INGEST','SOURCE',?,'SUCCEEDED',1,now(),now(),now())",job,UUID.fromString(workspace),source);
                var payload=json.createObjectNode();payload.set("workbook",json.readTree(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-csv.json"))).get("workbook"));
                jdbc.update("INSERT INTO source_version_extractions(source_version_id,source_id,workspace_id,job_id,parser_version,content_sha256,payload,created_at,processing_version,schema_version) VALUES (?,?,?,?,'test',?,?::jsonb,now(),'source-ingest-4','4.0')",version,source,UUID.fromString(workspace),job,hash,json.writeValueAsString(payload));
                String path="/api/workspaces/"+workspace+"/analyses";
                var created=owner.postJson(path,json.writeValueAsString(Map.of("userPrompt","Plot impedance versus frequency","inputs",List.of(Map.of("sourceId",source,"sourceVersionId",version,"sheetName","CSV","columns",List.of(1,2))))));
                assertEquals(201,created.statusCode(),created.body());String id=owner.json(created).get("id").asString();
                first.getBean(AnalysisApiIntegrationTest.TestPlanner.class).chart=true;
                assertEquals(200,owner.postJson(path+"/"+id+"/plan","{}").statusCode());
                first.getBean(AnalysisApiIntegrationTest.TestRunner.class).files=Map.of("plot.svg",svg,"result.json","""
                    {"schemaVersion":"2.0","outputs":[{"name":"result","kind":"TABLE","columns":["f","Z"],"rows":[[100,2]]},
                    {"name":"plot","kind":"CHART","file":"plot.svg","title":"Impedance versus frequency",
                    "xAxis":{"label":"Frequency","unit":"Hz","scale":"LINEAR"},"yAxis":{"label":"Impedance","unit":"Ω","scale":"LINEAR"},
                    "series":[{"name":"Z","tableName":"result","xColumn":"f","yColumn":"Z","yTransform":"IDENTITY"}]}]}
                    """.getBytes(StandardCharsets.UTF_8));
                var queued=owner.postJson(path+"/"+id+"/execute","{}");assertEquals(202,queued.statusCode(),queued.body());
                String executionId=owner.json(queued).get("id").asString();first.getBean(AnalysisExecutionDispatcher.class).dispatchAvailable();
                endpoint=path+"/"+id+"/executions/"+executionId+"/record";
                var response=owner.get(endpoint);assertEquals(200,response.statusCode(),response.body());before=response.body();var record=owner.json(response);
                assertEquals("SUCCEEDED",record.get("execution").get("status").asString());assertEquals(1,record.get("charts").get(0).get("series").get(0).get("pointCount").asInt());
                artifactEndpoint=path+"/"+id+"/executions/"+executionId+"/artifacts/"+record.get("charts").get(0).get("image").get("id").asString();
                assertArrayEquals(svg,owner.getBytes(artifactEndpoint).body());
                var citation=owner.get(endpoint.replaceFirst("/record$","/provenance"));assertEquals(200,citation.statusCode());
                provenanceBefore=citation.body();codeBefore=owner.get(endpoint.replaceFirst("/record$","/code")).body();
                assertEquals(artifactEndpoint,owner.json(citation).get("outputReferences").get(1).get("artifactUrl").asString());
            }
            try (var restarted=start(database)) {
                var owner=browser(restarted);assertEquals(200,owner.postJson("/api/auth/login","{\"email\":\"restart@example.test\",\"password\":\"correct-horse-battery-staple\"}").statusCode());
                var response=owner.get(endpoint);assertEquals(200,response.statusCode(),response.body());
                assertEquals(restarted.getBean(ObjectMapper.class).readTree(before),owner.json(response));
                assertEquals(restarted.getBean(ObjectMapper.class).readTree(provenanceBefore),owner.json(owner.get(endpoint.replaceFirst("/record$","/provenance"))));
                assertEquals(restarted.getBean(ObjectMapper.class).readTree(codeBefore),owner.json(owner.get(endpoint.replaceFirst("/record$","/code"))));
                var download=owner.getBytes(artifactEndpoint);assertEquals(200,download.statusCode());assertArrayEquals(svg,download.body());
                assertEquals("image/svg+xml",download.headers().firstValue("Content-Type").orElseThrow());
                assertEquals(0,restarted.getBean(AnalysisApiIntegrationTest.TestRunner.class).calls);
                assertEquals(401,new ApiBrowser(restarted.getEnvironment().getRequiredProperty("local.server.port",Integer.class),restarted.getBean(ObjectMapper.class)).get(endpoint).statusCode());
            }
        }
    }
}
