package dev.researchhub;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(classes = dev.researchhub.support.HttpSecurityTestApplication.class)
@ActiveProfiles("test")
class BackendApplicationTests {

    @Autowired
    private Environment environment;

    @Test
    void contextLoads() {
        List<String> profiles = List.of(environment.getActiveProfiles());
        assertTrue(profiles.contains("test"),
                "Tests must use the test profile so they do not require local or cloud secrets");
        assertFalse(profiles.contains("cloud"),
                "The cloud profile requires DB_URL and BLOB_ENDPOINT and must not run in tests");
    }

}
