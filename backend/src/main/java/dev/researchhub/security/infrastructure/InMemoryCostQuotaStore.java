package dev.researchhub.security.infrastructure;

import dev.researchhub.security.application.*;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Single-instance development adapter. Bounded state, fixed windows, atomic admission. */
public final class InMemoryCostQuotaStore implements CostQuotaStore {
    private record Key(boolean workspace, UUID id, CostCategory category) {}
    private record Bucket(int requests, Instant expiresAt) {}
    private final Map<Key, Bucket> buckets = new HashMap<>();
    private final Clock clock;
    private final int maxBuckets;

    public InMemoryCostQuotaStore(Clock clock, int maxBuckets) {
        if (maxBuckets < 2) throw new IllegalArgumentException("At least two quota buckets are required");
        this.clock = java.util.Objects.requireNonNull(clock);
        this.maxBuckets = maxBuckets;
    }

    @Override
    public synchronized void admit(UUID userId, UUID workspaceId, CostCategory category, QuotaPolicy policy) {
        Instant now = clock.instant();
        buckets.values().removeIf(bucket -> !bucket.expiresAt().isAfter(now));
        Key user = new Key(false, userId, category);
        Key workspace = new Key(true, workspaceId, category);
        Bucket u = buckets.get(user), w = buckets.get(workspace);
        long wait = Math.max(retry(u, policy.userRequests(), now), retry(w, policy.workspaceRequests(), now));
        if (wait > 0) throw new RateLimitExceededException(category, wait);
        int additions = (u == null ? 1 : 0) + (w == null ? 1 : 0);
        if (buckets.size() + additions > maxBuckets) {
            long seconds = buckets.values().stream().mapToLong(b -> seconds(now, b.expiresAt())).min().orElse(1);
            throw new RateLimitExceededException(category, seconds);
        }
        buckets.put(user, increment(u, now, policy));
        buckets.put(workspace, increment(w, now, policy));
    }

    private static Bucket increment(Bucket bucket, Instant now, QuotaPolicy policy) {
        return bucket == null ? new Bucket(1, now.plus(policy.window()))
                : new Bucket(bucket.requests() + 1, bucket.expiresAt());
    }
    private static long retry(Bucket bucket, int limit, Instant now) {
        return bucket != null && bucket.requests() >= limit ? seconds(now, bucket.expiresAt()) : 0;
    }
    private static long seconds(Instant now, Instant expires) {
        return Math.max(1, (java.time.Duration.between(now, expires).toMillis() + 999) / 1000);
    }
}
