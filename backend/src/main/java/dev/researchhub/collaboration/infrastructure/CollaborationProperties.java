package dev.researchhub.collaboration.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.time.Duration;

@Component
@ConfigurationProperties("researchhub.collaboration")
public class CollaborationProperties {
    private boolean enabled;
    private String serviceToken = "";
    private String websocketUrl = "ws://localhost:8091";
    private Duration tokenTtl = Duration.ofSeconds(120);
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean value) { enabled = value; }
    public String getServiceToken() { return serviceToken; }
    public void setServiceToken(String value) { serviceToken = value; }
    public String getWebsocketUrl() { return websocketUrl; }
    public void setWebsocketUrl(String value) { websocketUrl = value; }
    public Duration getTokenTtl() { return tokenTtl; }
    public void setTokenTtl(Duration value) { tokenTtl = value; }
    public void validate() {
        if (!enabled) return;
        URI url = URI.create(websocketUrl);
        if (serviceToken.length() < 32 || tokenTtl.toSeconds() < 10 || tokenTtl.toSeconds() > 120
                || !("ws".equals(url.getScheme()) || "wss".equals(url.getScheme())) || url.getHost() == null
                || url.getQuery() != null || url.getUserInfo() != null) {
            throw new IllegalStateException("Invalid collaboration configuration");
        }
    }
    @jakarta.annotation.PostConstruct
    void initialize() { validate(); }
}
