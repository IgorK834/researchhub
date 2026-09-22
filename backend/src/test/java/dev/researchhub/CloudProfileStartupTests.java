package dev.researchhub;

import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

class CloudProfileStartupTests {

    @Test
    void cloudProfileFailsWhenMandatorySettingsAreMissing() {
        ConfigurableApplicationContext context = null;
        try {
            context = new SpringApplicationBuilder(BackendApplication.class)
                    .profiles("cloud")
                    .web(WebApplicationType.NONE)
                    .run();
            fail("cloud profile started without DB_URL and BLOB_ENDPOINT");
        } catch (Exception ex) {
            assertTrue(mentionsMissingSetting(ex),
                    "startup failure should name DB_URL, but was: " + ex);
        } finally {
            if (context != null) {
                context.close();
            }
        }
    }

    private static boolean mentionsMissingSetting(Throwable failure) {
        Throwable current = failure;
        while (current != null) {
            String message = current.getMessage();
            if (message != null && message.contains("DB_URL")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

}
