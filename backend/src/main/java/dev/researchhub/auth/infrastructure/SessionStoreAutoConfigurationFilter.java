package dev.researchhub.auth.infrastructure;

import org.springframework.boot.autoconfigure.AutoConfigurationImportFilter;
import org.springframework.boot.autoconfigure.AutoConfigurationMetadata;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.env.Environment;

/** Selects the session store before Boot can enable JDBC merely because its starter is present. */
public final class SessionStoreAutoConfigurationFilter implements AutoConfigurationImportFilter, EnvironmentAware {
    private static final String JDBC_CONFIGURATION =
            "org.springframework.boot.session.jdbc.autoconfigure.JdbcSessionAutoConfiguration";
    private Environment environment;

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    @Override
    public boolean[] match(String[] autoConfigurationClasses, AutoConfigurationMetadata metadata) {
        String store = environment.getProperty("researchhub.auth.session-store", "servlet");
        if (!"jdbc".equals(store) && !"servlet".equals(store)) {
            throw new IllegalStateException("researchhub.auth.session-store must be jdbc or servlet");
        }
        boolean[] matches = new boolean[autoConfigurationClasses.length];
        for (int i = 0; i < matches.length; i++) {
            matches[i] = !JDBC_CONFIGURATION.equals(autoConfigurationClasses[i]) || "jdbc".equals(store);
        }
        return matches;
    }
}
