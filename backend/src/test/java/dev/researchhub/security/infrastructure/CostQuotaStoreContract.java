package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.*;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.*;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** The same behavioral assertions run against both adapters. */
abstract class CostQuotaStoreContract {
    protected static final UUID USER = UUID.randomUUID(), WORKSPACE = UUID.randomUUID();
    protected final MutableClock clock = new MutableClock();
    protected SimpleMeterRegistry metrics;
    protected CostQuotaStore store;

    protected abstract CostQuotaStore createStore(Clock clock, SimpleMeterRegistry metrics);

    @BeforeEach void resetContract() {
        clock.now = Instant.parse("2026-10-07T12:00:00Z");
        metrics = new SimpleMeterRegistry();
        store = createStore(clock, metrics);
    }

    @Test void userBudgetIsGlobalAcrossWorkspaces() {
        var policy = policy(2, 10);
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        store.admit(USER, UUID.randomUUID(), CostCategory.LLM, policy);
        rejected(USER, UUID.randomUUID(), CostCategory.LLM, policy, 60);
    }

    @Test void workspaceBudgetIsGlobalAcrossUsers() {
        var policy = policy(10, 2);
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        store.admit(UUID.randomUUID(), WORKSPACE, CostCategory.LLM, policy);
        rejected(UUID.randomUUID(), WORKSPACE, CostCategory.LLM, policy, 60);
    }

    @Test void workspaceRejectionRollsBackAnExistingUserIncrement() {
        var policy = policy(2, 1);
        UUID full = UUID.randomUUID(), available = UUID.randomUUID();
        store.admit(UUID.randomUUID(), full, CostCategory.LLM, policy);
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        rejected(USER, full, CostCategory.LLM, policy, 60);
        store.admit(USER, available, CostCategory.LLM, policy);
        rejected(USER, UUID.randomUUID(), CostCategory.LLM, policy, 60);
    }

    @Test void workspaceRejectionDoesNotCreateAChargedUserBucket() {
        var policy = policy(1, 1);
        store.admit(UUID.randomUUID(), WORKSPACE, CostCategory.LLM, policy);
        rejected(USER, WORKSPACE, CostCategory.LLM, policy, 60);
        store.admit(USER, UUID.randomUUID(), CostCategory.LLM, policy);
    }

    @Test void userRejectionDoesNotConsumeAnExistingWorkspaceOrANewWorkspace() {
        var policy = policy(1, 2);
        UUID other = UUID.randomUUID(), newWorkspace = UUID.randomUUID();
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        store.admit(other, UUID.randomUUID(), CostCategory.LLM, policy);
        rejected(other, WORKSPACE, CostCategory.LLM, policy, 60);
        rejected(other, newWorkspace, CostCategory.LLM, policy, 60);
        store.admit(UUID.randomUUID(), WORKSPACE, CostCategory.LLM, policy);
        store.admit(UUID.randomUUID(), newWorkspace, CostCategory.LLM, policy);
        store.admit(UUID.randomUUID(), newWorkspace, CostCategory.LLM, policy);
    }

    @Test void scopesAndCategoriesRemainIndependentEvenForTheSameUuid() {
        var policy = policy(1, 1);
        for (var category : CostCategory.values()) {
            store.admit(USER, USER, category, policy);
            rejected(USER, USER, category, policy, 60);
        }
    }

    @Test void windowsAreAlignedAndRetryDelayRoundsUp() {
        clock.now = Instant.parse("2026-10-07T12:00:59.001Z");
        var policy = policy(1, 1);
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        rejected(USER, WORKSPACE, CostCategory.LLM, policy, 1);
        clock.now = Instant.parse("2026-10-07T12:01:00Z");
        store.admit(USER, WORKSPACE, CostCategory.LLM, policy);
        rejected(USER, WORKSPACE, CostCategory.LLM, policy, 60);
    }

    @Test void nonMinuteAndFractionalWindowsUseTheSameTruncation() {
        for (Duration duration : new Duration[]{Duration.ofSeconds(7), Duration.ofMillis(1500)}) {
            UUID user = UUID.randomUUID(), workspace = UUID.randomUUID();
            clock.now = Instant.ofEpochSecond(8, 100_000_000);
            var policy = new QuotaPolicy(1, 1, duration);
            store.admit(user, workspace, CostCategory.LLM, policy);
            long wait = duration.equals(Duration.ofSeconds(7)) ? 6 : 1;
            rejected(user, workspace, CostCategory.LLM, policy, wait);
            clock.now = duration.equals(Duration.ofSeconds(7)) ? Instant.ofEpochSecond(14) : Instant.ofEpochSecond(9);
            store.admit(user, workspace, CostCategory.LLM, policy);
        }
    }

    @Test void oneCounterIncrementPerRejectedAdmissionAndCategory() {
        var policy = policy(1, 1);
        for (var category : CostCategory.values()) {
            store.admit(USER, WORKSPACE, category, policy);
            rejected(USER, WORKSPACE, category, policy, 60);
            rejected(USER, WORKSPACE, category, policy, 60);
            assertEquals(2, metrics.get("researchhub.security.quotas.rejections")
                    .tag("category", category.name()).counter().count());
        }
    }

    protected void rejected(UUID user, UUID workspace, CostCategory category, QuotaPolicy policy, long seconds) {
        var failure = assertThrows(RateLimitExceededException.class, () -> store.admit(user, workspace, category, policy));
        assertEquals(category.name(), failure.properties().get("quotaCategory"));
        assertEquals(seconds, failure.properties().get("retryAfterSeconds"));
    }

    protected static QuotaPolicy policy(int user, int workspace) {
        return new QuotaPolicy(user, workspace, Duration.ofMinutes(1));
    }

    static final class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-10-07T12:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
