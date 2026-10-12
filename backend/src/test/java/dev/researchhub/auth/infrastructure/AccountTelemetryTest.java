package dev.researchhub.auth.infrastructure;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.regex.Pattern;
import static org.junit.jupiter.api.Assertions.*;

class AccountTelemetryTest {
    @Test void invitationBearerSecretsAreRemovedFromAllExportedUrlAttributes() throws Exception {
        var config=new ObjectMapper().readTree(Files.readString(Path.of("observability/applicationinsights.json")));
        String secret="a".repeat(43);
        for(var action:config.path("preview").path("processors").get(0).path("actions")) {
            String url="https://app.example.test/api/invitations/"+secret+"/accept";
            String masked=Pattern.compile(action.path("pattern").asString()).matcher(url).replaceAll(action.path("replace").asString());
            assertFalse(masked.contains(secret));assertTrue(masked.endsWith("/api/invitations/REDACTED/accept"));
        }
        assertEquals("OFF",config.path("instrumentation").path("logging").path("level").asString());
    }
}
