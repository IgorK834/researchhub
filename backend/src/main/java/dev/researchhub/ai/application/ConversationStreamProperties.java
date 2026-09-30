package dev.researchhub.ai.application;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("local")
public record ConversationStreamProperties(int maxConcurrent, Duration timeout, Duration heartbeat) {
    public ConversationStreamProperties(@Value("${researchhub.ai.conversations.stream.max-concurrent:8}") int maxConcurrent,
        @Value("${researchhub.ai.conversations.stream.timeout:PT90S}") Duration timeout,
        @Value("${researchhub.ai.conversations.stream.heartbeat:PT10S}") Duration heartbeat) {
        if (maxConcurrent < 1 || maxConcurrent > 64 || timeout == null || timeout.compareTo(Duration.ofSeconds(5)) < 0
            || timeout.compareTo(Duration.ofMinutes(4)) > 0 || heartbeat == null || heartbeat.compareTo(Duration.ofMillis(100)) < 0
            || heartbeat.compareTo(timeout.dividedBy(2)) > 0) throw new IllegalArgumentException("Invalid conversation stream limits");
        this.maxConcurrent=maxConcurrent; this.timeout=timeout; this.heartbeat=heartbeat;
    }
}
