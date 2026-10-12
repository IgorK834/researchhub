package dev.researchhub.shared.observability;

import java.util.LinkedHashMap;
import org.flywaydb.core.Flyway;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.info.Info;
import org.springframework.boot.actuate.info.InfoContributor;
import org.springframework.boot.info.BuildProperties;
import org.springframework.stereotype.Component;

/** Operational metadata only: no datasource URL, secret, actor or private content. */
@Component
public class DeploymentInfoContributor implements InfoContributor {
    private final BuildProperties build;
    private final ObjectProvider<Flyway> flyway;
    private final String commit, imageDigest, instanceId;
    public DeploymentInfoContributor(ObjectProvider<BuildProperties> builds, ObjectProvider<Flyway> flyway,
            @Value("${researchhub.build-commit:unknown}") String commit,
            @Value("${researchhub.instance-id:unknown-host}") String instanceId,
            @Value("${researchhub.observability.image-digest:}") String imageDigest,
            @Value("${researchhub.observability.expected-commit:}") String expectedCommit,
            @Value("${researchhub.observability.require-identity:false}") boolean required) {
        this.build = builds.getIfAvailable(); this.flyway = flyway; this.commit = commit; this.instanceId = instanceId;
        this.imageDigest = imageDigest;
        if ((!imageDigest.isEmpty() && !imageDigest.matches("sha256:[a-f0-9]{64}"))
                || (!expectedCommit.isEmpty() && !expectedCommit.equals(commit))
                || (required && ("unknown".equals(commit) || imageDigest.isEmpty() || expectedCommit.isEmpty()
                    || build == null || build.getTime() == null))) {
            throw new IllegalStateException("Deployment build/image identity is missing or inconsistent");
        }
    }
    @Override public void contribute(Info.Builder builder) {
        var data = new LinkedHashMap<String, Object>();
        data.put("commit", commit); data.put("instanceId", instanceId);
        data.put("imageDigest", imageDigest.isEmpty() ? "unknown" : imageDigest);
        data.put("buildTime", build == null || build.getTime() == null ? "unknown" : build.getTime().toString());
        Flyway migrations = flyway.getIfAvailable();
        var current = migrations == null ? null : migrations.info().current();
        data.put("flywayVersion", current == null || current.getVersion() == null ? "none" : current.getVersion().getVersion());
        builder.withDetail("deployment", data);
    }
}
