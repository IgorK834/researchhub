package dev.researchhub.shared.infrastructure.persistence;

import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@EntityScan(basePackages = "dev.researchhub")
public class JpaPersistenceConfiguration {
}
