package dev.researchhub.collaboration.infrastructure;
import org.junit.jupiter.api.Test;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;
class CollaborationPropertiesTest {
    @Test void disabledNeedsNoSecretsButEnabledFailsClosed() {
        var properties = new CollaborationProperties(); properties.validate();
        properties.setEnabled(true); assertThrows(IllegalStateException.class, properties::validate);
        properties.setServiceToken("x".repeat(32)); properties.validate();
        for (String url : new String[]{"https://example.test", "ws://localhost?token=x", "ws://name@localhost"}) {
            properties.setWebsocketUrl(url); assertThrows(IllegalStateException.class,properties::validate);
        }
        properties.setWebsocketUrl("wss://example.test/realtime"); properties.validate();
        properties.setTokenTtl(Duration.ofSeconds(121)); assertThrows(IllegalStateException.class,properties::validate);
        properties.setTokenTtl(Duration.ofSeconds(1)); assertThrows(IllegalStateException.class,properties::validate);
    }
}
