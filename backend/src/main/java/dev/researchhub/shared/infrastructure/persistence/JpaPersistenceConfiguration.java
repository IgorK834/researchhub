package dev.researchhub.shared.infrastructure.persistence;

import org.springframework.boot.persistence.autoconfigure.EntityScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@Configuration
@Profile("local")
@EntityScan(basePackages = "dev.researchhub")
@EnableJpaRepositories(basePackages = "dev.researchhub")
public class JpaPersistenceConfiguration {
}
