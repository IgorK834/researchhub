package dev.researchhub.processing.infrastructure;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ProcessingPropertiesTest {

    @Test
    void bindsACompleteValidPolicy() {
        ProcessingProperties properties = new ProcessingProperties();
        ProcessingProperties.Dispatcher dispatcher = properties.getDispatcher();
        dispatcher.setEnabled(false);
        dispatcher.setFixedDelay(Duration.ofSeconds(3));
        dispatcher.setBatchSize(7);
        dispatcher.setMaxAttempts(4);
        dispatcher.setInitialBackoff(Duration.ofSeconds(5));
        dispatcher.setMaxBackoff(Duration.ofMinutes(2));
        dispatcher.setStaleTimeout(Duration.ofMinutes(9));
        properties.getWorker().setBaseUrl(URI.create("https://worker.internal"));
        properties.getWorker().setRequestTimeout(Duration.ofSeconds(12));

        assertFalse(dispatcher.isEnabled());
        assertEquals(Duration.ofSeconds(3), dispatcher.getFixedDelay());
        assertEquals(7, dispatcher.getBatchSize());
        assertEquals(4, dispatcher.getMaxAttempts());
        assertEquals(Duration.ofSeconds(5), dispatcher.getInitialBackoff());
        assertEquals(Duration.ofMinutes(2), dispatcher.getMaxBackoff());
        assertEquals(Duration.ofMinutes(9), dispatcher.getStaleTimeout());
        assertEquals(URI.create("https://worker.internal"), properties.getWorker().getBaseUrl());
        assertEquals(Duration.ofSeconds(12), properties.getWorker().getRequestTimeout());
    }

    @Test
    void refusesUnsafeOrUnboundedPolicyValues() {
        ProcessingProperties properties = new ProcessingProperties();
        ProcessingProperties.Dispatcher dispatcher = properties.getDispatcher();

        assertThrows(IllegalArgumentException.class, () -> dispatcher.setBatchSize(0));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setBatchSize(101));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setMaxAttempts(0));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setMaxAttempts(101));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setFixedDelay(Duration.ZERO));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setInitialBackoff(Duration.ofSeconds(-1)));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setMaxBackoff(null));
        assertThrows(IllegalArgumentException.class, () -> dispatcher.setStaleTimeout(Duration.ZERO));
        assertThrows(IllegalArgumentException.class, () -> properties.getWorker().setBaseUrl(null));
        assertThrows(IllegalArgumentException.class, () -> properties.getWorker().setBaseUrl(URI.create("/worker")));
        assertThrows(IllegalArgumentException.class,
                () -> properties.getWorker().setBaseUrl(URI.create("file:///tmp/worker")));
        assertThrows(IllegalArgumentException.class,
                () -> properties.getWorker().setRequestTimeout(Duration.ZERO));
    }
}
