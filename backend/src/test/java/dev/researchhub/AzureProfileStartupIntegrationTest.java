package dev.researchhub;

import com.azure.core.http.jdk.httpclient.JdkHttpClientBuilder;
import com.azure.storage.blob.*;
import com.zaxxer.hikari.HikariDataSource;
import dev.researchhub.analysis.application.*;
import dev.researchhub.analysis.application.AnalysisContracts.*;
import dev.researchhub.ai.application.GenerationContracts.*;
import dev.researchhub.analysis.infrastructure.DockerSandboxRunner;
import dev.researchhub.source.SourceRowFixture;
import dev.researchhub.source.application.*;
import dev.researchhub.source.domain.StorageKey;
import dev.researchhub.source.infrastructure.*;
import dev.researchhub.security.infrastructure.*;
import dev.researchhub.support.RequiredProductBeans;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.cert.CertificateFactory;
import java.time.*;
import java.util.*;
import javax.net.ssl.*;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.*;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Actual Azure product graph, Flyway, JDBC sessions, quotas and HTTPS Blob traffic to a provisioned stand-in. */
@Testcontainers
class AzureProfileStartupIntegrationTest {
    private static final String KEY="Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
    private static final String SCRAPE="azure-test-scrape-token-at-least-32-characters";
    private static final TestTls TLS=TestTls.generate();
    @Container static final PostgreSQLContainer POSTGRES=new PostgreSQLContainer(
        DockerImageName.parse("pgvector/pgvector:0.8.2-pg17-bookworm").asCompatibleSubstituteFor("postgres"));
    @Container static final GenericContainer<?> AZURITE=new GenericContainer<>(
        DockerImageName.parse("mcr.microsoft.com/azure-storage/azurite:3.37.0"))
        .withExposedPorts(10000)
        .withCopyFileToContainer(MountableFile.forHostPath(TLS.certificate().toString()),"/cert.pem")
        .withCopyFileToContainer(MountableFile.forHostPath(TLS.key().toString()),"/key.pem")
        .withCommand("azurite-blob","--blobHost","0.0.0.0","--blobPort","10000","--location","/data",
            "--cert","/cert.pem","--key","/key.pem")
        .waitingFor(Wait.forListeningPort());

    static String blobEndpoint() { return "https://"+AZURITE.getHost()+":"+AZURITE.getMappedPort(10000)+"/devstoreaccount1"; }
    @org.junit.jupiter.api.BeforeEach void startApplication() {
        application=new org.springframework.boot.builder.SpringApplicationBuilder(BackendApplication.class,TrustedTestCertificate.class)
            .profiles("azure").run("--server.port=0", "--DB_URL="+POSTGRES.getJdbcUrl(), "--DB_USER="+POSTGRES.getUsername(),
                "--DB_PASSWORD="+POSTGRES.getPassword(), "--BLOB_ENDPOINT="+blobEndpoint(),
                "--BLOB_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=devstoreaccount1;AccountKey="+KEY+";BlobEndpoint="+blobEndpoint(),
                "--AI_WORKER_BASE_URL=http://worker.test:8090", "--AI_WORKER_SERVICE_TOKEN=azure-test-worker-token-at-least-32-characters",
                "--METRICS_SCRAPE_TOKEN="+SCRAPE, "--server.ssl.enabled=true", "--server.ssl.key-store="+keyStore(),
                "--server.ssl.key-store-password=test-only", "--server.ssl.key-store-type=PKCS12",
                "--researchhub.processing.dispatcher.enabled=false", "--researchhub.analysis.execution.dispatcher.enabled=false",
                "--researchhub.export.dispatcher.enabled=false", "--researchhub.documents.history.scheduler.fixed-delay=PT1H");
        jdbc=application.getBean(JdbcTemplate.class);flyway=application.getBean(Flyway.class);json=application.getBean(ObjectMapper.class);
        storage=application.getBean(SourceStorage.class);sources=application.getBean(SourceService.class);
        container=application.getBean(BlobContainerClient.class);executionDispatcher=application.getBean(AnalysisExecutionDispatcher.class);
        metrics=application.getBean(MeterRegistry.class);
    }
    @org.junit.jupiter.api.AfterEach void closeApplication() { if(application!=null) application.close(); }
    @TestConfiguration(proxyBeanMethods=false) static class TrustedTestCertificate {
        @Bean @Primary BlobServiceClientFactory testCertificateBlobFactory() {
            // Trust only the fixture CA. Endpoint, credentials, adapter and provisioning policy remain real Azure settings.
            return (storage,auth) -> new BlobServiceClientBuilder().endpoint(storage.endpoint())
                .connectionString(auth.connectionString())
                .httpClient(new JdkHttpClientBuilder(HttpClient.newBuilder().sslContext(trust())).build()).buildClient();
        }
        @Bean @Primary AnalysisPlanner testPlanner(ObjectMapper json) {
            return request -> {
                var version=request.inputs().getFirst().selection().sourceVersionId();
                var plan=new Plan("1.0","Select columns",List.of(new PlanInput(version,"CSV",List.of(1,2))),List.of(),List.of(),
                    List.of(new Output(OutputKind.TABLE,"result","Selected data",List.of(version))),List.of(),
                    List.of("Code is untrusted"),new Code("PYTHON","raise RuntimeError('no Azure runner exists')"));
                return new Candidate("1.0",request.request().requestId(),
                    new ModelMetadata("deterministic","profile-test","1",true,false),new Usage(1,1,2,true),
                    "profile-test",json.writeValueAsString(plan));
            };
        }
    }
    org.springframework.context.ConfigurableApplicationContext application;
    JdbcTemplate jdbc;
    Flyway flyway;
    ObjectMapper json;
    SourceStorage storage;
    SourceService sources;
    BlobContainerClient container;
    AnalysisExecutionDispatcher executionDispatcher;
    MeterRegistry metrics;

    @Test void fullAzureApplicationServesHealthAndUsesOnlySharedInfrastructure() throws Exception {
        RequiredProductBeans.assertPresent(application);
        assertTrue(Arrays.stream(flyway.info().applied()).anyMatch(m -> "37".equals(m.getVersion().getVersion())));
        assertEquals(0,flyway.info().pending().length);
        assertTrue(application.getBeansOfType(DockerSandboxRunner.class).isEmpty());
        assertTrue(application.getBeansOfType(InMemoryCostQuotaStore.class).isEmpty());
        assertEquals(1,application.getBeansOfType(PostgresCostQuotaStore.class).size());
        assertEquals(1,application.getBeansOfType(org.springframework.session.jdbc.JdbcIndexedSessionRepository.class).size());
        assertEquals(1,application.getBeansOfType(DataSource.class).size());
        var pool=application.getBean(HikariDataSource.class);
        assertSame(pool,jdbc.getDataSource()); assertEquals(8,pool.getMaximumPoolSize()); assertEquals(2,pool.getMinimumIdle());
        assertEquals(3000,pool.getConnectionTimeout()); assertEquals(240000,pool.getMaxLifetime()); assertEquals(0,pool.getLeakDetectionThreshold());
        assertNotNull(metrics.find("hikaricp.connections.active").gauge());
        try(var browser=new Browser()) {
            var health=browser.send("GET","/actuator/health",null);
            assertEquals(200,health.statusCode(),health.body()); assertEquals("UP",json.readTree(health.body()).path("status").asString());
            assertFalse(health.body().contains("components"));
            assertEquals(401,browser.send("GET","/actuator/prometheus",null).statusCode());
            var scrape=browser.http.send(HttpRequest.newBuilder(browser.uri("/actuator/prometheus"))
                .header("Authorization","Bearer "+SCRAPE).GET().build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(200,scrape.statusCode()); assertTrue(scrape.body().contains("hikaricp_connections_active"));
            assertEquals(401,browser.send("GET","/actuator/env",null).statusCode());
            assertEquals(204,browser.send("GET","/api/auth/csrf",null).statusCode());
            var register=browser.send("POST","/api/auth/register","""
                {"email":"azure@example.test","password":"correct-horse-battery-staple","displayName":"Azure Researcher"}
                """);
            assertEquals(403,register.statusCode(),register.body());
            assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM users",Integer.class));
            UUID owner=dev.researchhub.workspace.UserRowFixture.insertUser(jdbc,"azure@example.test","Azure Researcher");
            jdbc.update("UPDATE users SET password_hash=? WHERE id=?",application.getBean(org.springframework.security.crypto.password.PasswordEncoder.class)
                .encode("correct-horse-battery-staple"),owner);
            var login=browser.send("POST","/api/auth/login","""
                {"email":"azure@example.test","password":"correct-horse-battery-staple"}
                """);
            assertEquals(200,login.statusCode(),login.body());
            assertTrue(login.headers().allValues("Set-Cookie").stream().anyMatch(c -> c.startsWith("JSESSIONID=") && c.contains("Secure") && c.contains("HttpOnly")));
            assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM spring_session",Integer.class));
            var workspaceResponse=browser.send("POST","/api/workspaces","{\"name\":\"Azure lab\"}");
            assertEquals(201,workspaceResponse.statusCode(),workspaceResponse.body());
            UUID workspace=UUID.fromString(json.readTree(workspaceResponse.body()).path("id").asString());
            assertEquals(200,browser.send("GET","/api/workspaces/"+workspace,null).statusCode());
            // The test provisions the container, exactly as deployment infrastructure does.
            assertFalse(container.exists()); container.create();
            byte[] bytes="Frequency,Resistance\n1,10\n2,29\n".getBytes(StandardCharsets.UTF_8);
            var uploaded=sources.upload(workspace,owner,new UploadSourceCommand("data.csv","text/csv",(long)bytes.length,new ByteArrayInputStream(bytes)));
            try(var read=sources.openContent(workspace,owner,uploaded.id()).content()) { assertArrayEquals(bytes,read.readAllBytes()); }
            assertTrue(application.getBean(BlobServiceClient.class).getAccountUrl().startsWith("https://"));
            UUID source=UUID.randomUUID(); storage.store(new StorageKey("sources/"+source),new ByteArrayInputStream(bytes),"text/csv");
            String hash=ExecutionOutputValidator.sha256(bytes);
            UUID version=SourceRowFixture.insert(jdbc,source,workspace,owner,"ready.csv","ready.csv","text/csv","CSV",bytes.length,
                "sources/"+source,hash,"READY",null,Instant.now());
            UUID job=UUID.randomUUID();
            jdbc.update("INSERT INTO processing_jobs(id,workspace_id,job_type,resource_type,resource_id,status,attempt_count,created_at,started_at,finished_at) VALUES (?,?,'SOURCE_INGEST','SOURCE',?,'SUCCEEDED',1,now(),now(),now())",job,workspace,source);
            var extraction=json.createObjectNode();extraction.set("workbook",json.readTree(Files.readString(Path.of("../contracts/processing/v4/source-ingest-result-csv.json"))).get("workbook"));
            jdbc.update("INSERT INTO source_version_extractions(source_version_id,source_id,workspace_id,job_id,parser_version,content_sha256,payload,created_at,processing_version,schema_version) VALUES (?,?,?,?,'test',?,?::jsonb,now(),'source-ingest-4','4.0')",
                version,source,workspace,job,hash,json.writeValueAsString(extraction));
            String path="/api/workspaces/"+workspace+"/analyses";
            var analysis=browser.send("POST",path,json.writeValueAsString(new Create("Select columns",List.of(new Input(source,version,"CSV",List.of(1,2))))));
            assertEquals(201,analysis.statusCode(),analysis.body());
            path+="/"+json.readTree(analysis.body()).path("id").asString();
            assertEquals(200,browser.send("POST",path+"/plan","{}").statusCode());
            var execution=browser.send("POST",path+"/execute","{}"); assertEquals(202,execution.statusCode(),execution.body());
            String executionId=json.readTree(execution.body()).path("id").asString();
            executionDispatcher.dispatchAvailable();
            var status=browser.send("GET",path+"/executions/"+executionId,null); assertEquals(200,status.statusCode(),status.body());
            assertEquals("FAILED",json.readTree(status.body()).path("status").asString());
            assertEquals("SANDBOX_UNAVAILABLE",json.readTree(status.body()).path("failureCode").asString());
        }
    }

    private static SSLContext trust() {
        try {
            var store=KeyStore.getInstance("PKCS12");store.load(null,null);
            try(var pem=Files.newInputStream(TLS.certificate())) {
                store.setCertificateEntry("test-ca",CertificateFactory.getInstance("X.509").generateCertificate(pem));
            }
            var manager=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());manager.init(store);
            var ssl=SSLContext.getInstance("TLS");ssl.init(null,manager.getTrustManagers(),null);return ssl;
        } catch(Exception failure) { throw new IllegalStateException("Cannot load test CA",failure); }
    }
    private static String keyStore() { return TLS.store().toUri().toString(); }

    /** JDK-only disposable identity: no private key or long-lived certificate is committed to the repository. */
    private record TestTls(Path store,Path certificate,Path key) {
        static TestTls generate() {
            try {
                Path directory=Files.createTempDirectory("rh-azure-test-tls-");
                Path store=directory.resolve("server.p12"),certificate=directory.resolve("cert.pem"),key=directory.resolve("key.pem");
                var command=new ProcessBuilder(Path.of(System.getProperty("java.home"),"bin","keytool").toString(),
                    "-genkeypair","-alias","test-server","-keyalg","RSA","-keysize","2048","-validity","2",
                    "-dname","CN=localhost,O=ResearchHub test fixture","-ext","SAN=dns:localhost,ip:127.0.0.1",
                    "-storetype","PKCS12","-keystore",store.toString(),"-storepass","test-only","-keypass","test-only","-noprompt")
                    .redirectErrorStream(true).redirectOutput(directory.resolve("keytool.log").toFile()).start();
                if (!command.waitFor(30,java.util.concurrent.TimeUnit.SECONDS)) {
                    command.destroyForcibly();throw new IllegalStateException("Test keytool timed out");
                }
                if(command.exitValue()!=0) throw new IllegalStateException("Test keytool failed");
                var keystore=KeyStore.getInstance("PKCS12");
                try(var input=Files.newInputStream(store)) { keystore.load(input,"test-only".toCharArray()); }
                writePem(certificate,"CERTIFICATE",keystore.getCertificate("test-server").getEncoded());
                writePem(key,"PRIVATE KEY",keystore.getKey("test-server","test-only".toCharArray()).getEncoded());
                directory.toFile().deleteOnExit();
                try(var files=Files.list(directory)) { files.forEach(file -> file.toFile().deleteOnExit()); }
                return new TestTls(store,certificate,key);
            } catch(Exception failure) { throw new IllegalStateException("Cannot build disposable test TLS identity",failure); }
        }
        private static void writePem(Path path,String type,byte[] bytes) throws IOException {
            Files.writeString(path,"-----BEGIN "+type+"-----\n"+
                Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(bytes)+"\n-----END "+type+"-----\n",StandardCharsets.US_ASCII);
        }
    }
    private class Browser implements AutoCloseable {
        final CookieManager cookies=new CookieManager();
        final HttpClient http=HttpClient.newBuilder().cookieHandler(cookies).sslContext(trust()).build();
        URI uri(String path) { return URI.create("https://localhost:"+application.getEnvironment().getRequiredProperty("local.server.port")+path); }
        HttpResponse<String> send(String method,String path,String body) throws Exception {
            var request=HttpRequest.newBuilder(uri(path)).timeout(Duration.ofSeconds(20));
            if(body==null) request.GET();
            else {
                String csrf=cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("XSRF-TOKEN"))
                    .map(HttpCookie::getValue).findFirst().orElseThrow();
                request.header("Content-Type","application/json").header("X-XSRF-TOKEN",csrf)
                    .method(method,HttpRequest.BodyPublishers.ofString(body));
            }
            return http.send(request.build(),HttpResponse.BodyHandlers.ofString());
        }
        public void close() { http.close(); }
    }
}
