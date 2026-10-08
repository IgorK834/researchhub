package dev.researchhub.security.infrastructure;

import java.math.BigInteger;
import java.time.Duration;
import java.time.Instant;

/** Fixed windows aligned to the Unix epoch, including durations that do not divide a day. */
record CostQuotaWindow(Instant start, Instant end) {
    private static final BigInteger NANOS = BigInteger.valueOf(1_000_000_000);

    static CostQuotaWindow at(Instant now, Duration duration) {
        BigInteger time = BigInteger.valueOf(now.getEpochSecond()).multiply(NANOS)
                .add(BigInteger.valueOf(now.getNano()));
        BigInteger size = BigInteger.valueOf(duration.toNanos());
        BigInteger remainder = time.mod(size);
        Instant start = now.minusNanos(remainder.longValueExact());
        return new CostQuotaWindow(start, start.plus(duration));
    }

    long retryAfterSeconds(Instant now) {
        Duration remaining = Duration.between(now, end);
        return Math.max(1, remaining.getSeconds() + (remaining.getNano() == 0 ? 0 : 1));
    }
}
