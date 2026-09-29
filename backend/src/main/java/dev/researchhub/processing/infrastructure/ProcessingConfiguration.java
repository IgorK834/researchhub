package dev.researchhub.processing.infrastructure;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Enables the local database dispatcher without introducing a broker. */
@Configuration
@Profile("local")
@EnableScheduling
@EnableConfigurationProperties(ProcessingProperties.class)
public class ProcessingConfiguration {
}
