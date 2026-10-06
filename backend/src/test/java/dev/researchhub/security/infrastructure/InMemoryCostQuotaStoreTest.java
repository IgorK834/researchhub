package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.*;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class InMemoryCostQuotaStoreTest {
    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-06T12:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now; }
    }
    @Test void userIsGlobalAcrossWorkspacesAndCategoriesAreSeparate() {
        var store = new InMemoryCostQuotaStore(Clock.systemUTC(), 100);
        var policy = new QuotaPolicy(1, 10, Duration.ofMinutes(1));
        UUID user = UUID.randomUUID();
        store.admit(user, UUID.randomUUID(), CostCategory.LLM, policy);
        var error = assertThrows(RateLimitExceededException.class,
                () -> store.admit(user, UUID.randomUUID(), CostCategory.LLM, policy));
        assertEquals("LLM", error.properties().get("quotaCategory"));
        assertTrue((long) error.properties().get("retryAfterSeconds") >= 1);
        store.admit(user, UUID.randomUUID(), CostCategory.ANALYSIS, policy);
        store.admit(user, UUID.randomUUID(), CostCategory.RETRIEVAL, policy);
    }
    @Test void aWorkspaceDenialDoesNotConsumeTheUsersOtherWorkspaceBudget() {
        var store = new InMemoryCostQuotaStore(Clock.systemUTC(), 100);
        var policy = new QuotaPolicy(1, 1, Duration.ofMinutes(1));
        UUID workspace = UUID.randomUUID(), secondUser = UUID.randomUUID();
        store.admit(UUID.randomUUID(), workspace, CostCategory.LLM, policy);
        assertThrows(RateLimitExceededException.class, () -> store.admit(secondUser, workspace, CostCategory.LLM, policy));
        store.admit(secondUser, UUID.randomUUID(), CostCategory.LLM, policy);
    }
    @Test void expiryReleasesCapacityAndReturnsRoundedRetryTime() {
        MutableClock clock = new MutableClock();
        var store = new InMemoryCostQuotaStore(clock, 2);
        var policy = new QuotaPolicy(1, 1, Duration.ofSeconds(3));
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID();
        store.admit(user, workspace, CostCategory.LLM, policy);
        clock.now = clock.now.plusMillis(1001);
        var denied = assertThrows(RateLimitExceededException.class, () -> store.admit(user, workspace, CostCategory.LLM, policy));
        assertEquals(2L, denied.properties().get("retryAfterSeconds"));
        assertThrows(RateLimitExceededException.class, () -> store.admit(UUID.randomUUID(), UUID.randomUUID(), CostCategory.LLM, policy));
        clock.now = clock.now.plusMillis(1999);
        store.admit(user, workspace, CostCategory.LLM, policy);
        assertThrows(IllegalArgumentException.class, () -> new InMemoryCostQuotaStore(clock, 1));
    }
    @Test void concurrentRequestsNeverExceedEitherQuota() throws Exception {
        var store = new InMemoryCostQuotaStore(Clock.systemUTC(), 100);
        var policy = new QuotaPolicy(100, 7, Duration.ofMinutes(1));
        UUID workspace = UUID.randomUUID();
        AtomicInteger admitted = new AtomicInteger();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<?>> tasks = new ArrayList<>();
            for (int i = 0; i < 50; i++) tasks.add(executor.submit(() -> {
                try { store.admit(UUID.randomUUID(), workspace, CostCategory.LLM, policy); admitted.incrementAndGet(); }
                catch (RateLimitExceededException expected) { }
            }));
            for (var task : tasks) task.get();
        }
        assertEquals(7, admitted.get());
    }
    @Test void invalidPoliciesFailAtStartup() {
        for (var policy : List.of(new int[]{0, 1}, new int[]{1, 0}))
            assertThrows(IllegalArgumentException.class, () -> new QuotaPolicy(policy[0], policy[1], Duration.ofMinutes(1)));
        assertThrows(IllegalArgumentException.class, () -> new QuotaPolicy(1, 1, null));
        assertThrows(IllegalArgumentException.class, () -> new QuotaPolicy(1, 1, Duration.ZERO));
        assertThrows(IllegalArgumentException.class, () -> new QuotaPolicy(1, 1, Duration.ofDays(2)));
    }
}
