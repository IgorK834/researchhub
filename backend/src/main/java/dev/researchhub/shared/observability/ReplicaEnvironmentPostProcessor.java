package dev.researchhub.shared.observability;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/** Resolve before logging starts, so startup, scheduled and request logs use the same identity. */
public final class ReplicaEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {
    @Override public int getOrder() { return Ordered.HIGHEST_PRECEDENCE + 20; }
    @Override public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String id = environment.getProperty("researchhub.instance-id");
        if (id == null) {
            id = environment.getProperty("INSTANCE_ID", environment.getProperty("HOSTNAME", hostname()));
            environment.getPropertySources().addLast(new MapPropertySource("replicaHostname",
                    Map.of("researchhub.instance-id", id)));
        }
        if (!id.matches("[A-Za-z0-9._-]{1,128}"))
            throw new IllegalStateException("researchhub.instance-id must be a bounded hostname or replica identifier");
    }
    static String hostname() {
        try { return InetAddress.getLocalHost().getHostName(); }
        catch (UnknownHostException unavailable) { return "unknown-host"; }
    }
}
