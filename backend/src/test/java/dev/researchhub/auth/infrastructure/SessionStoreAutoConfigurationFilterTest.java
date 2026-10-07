package dev.researchhub.auth.infrastructure;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;

class SessionStoreAutoConfigurationFilterTest {
    private static final String JDBC = "org.springframework.boot.session.jdbc.autoconfigure.JdbcSessionAutoConfiguration";

    @Test void servletDefaultDisablesOnlyJdbcAndExplicitJdbcKeepsBootConfiguration() {
        var filter = new SessionStoreAutoConfigurationFilter();
        var environment = new MockEnvironment();
        filter.setEnvironment(environment);
        String[] candidates = {JDBC, "org.springframework.boot.session.autoconfigure.SessionAutoConfiguration", null};
        assertArrayEquals(new boolean[]{false, true, true}, filter.match(candidates, null));
        environment.setProperty("researchhub.auth.session-store", "servlet");
        assertArrayEquals(new boolean[]{false, true, true}, filter.match(candidates, null));
        environment.setProperty("researchhub.auth.session-store", "jdbc");
        assertArrayEquals(new boolean[]{true, true, true}, filter.match(candidates, null));
    }

    @Test void unknownStoreFailsStartupInsteadOfSilentlySelectingAnotherMechanism() {
        for (String store : new String[]{"", "redis", "JDBC"}) {
            var filter = new SessionStoreAutoConfigurationFilter();
            filter.setEnvironment(new MockEnvironment().withProperty("researchhub.auth.session-store", store));
            assertThrows(IllegalStateException.class, () -> filter.match(new String[]{JDBC}, null));
        }
    }
}
