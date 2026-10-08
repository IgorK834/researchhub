package dev.researchhub;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.support.RequiredProductBeans;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = {"researchhub.processing.dispatcher.enabled=false",
        "researchhub.analysis.execution.dispatcher.enabled=false", "researchhub.export.dispatcher.enabled=false",
        "researchhub.documents.history.scheduler.fixed-delay=PT1H"})
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class LocalProfileBeanGraphTests {
    @Autowired ApplicationContext application;

    @Test void localBootsEveryRequiredProductBean() {
        RequiredProductBeans.assertPresent(application);
    }

    @Test void fixedGraphAssertionDetectsRemovalOfARequiredBean() {
        try (var graph = new GenericApplicationContext()) {
            RequiredProductBeans.NAMES.forEach(name -> graph.registerBean(name, Object.class, Object::new));
            graph.refresh();
            RequiredProductBeans.assertPresent(graph);
            graph.removeBeanDefinition("workspaceService");
            var failure = assertThrows(AssertionError.class, () -> RequiredProductBeans.assertPresent(graph));
            assertTrue(failure.getMessage().contains("workspaceService"));
        }
    }
}
