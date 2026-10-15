package dev.researchhub.notification.application;

import java.time.Instant;
import java.util.*;

public final class DigestContracts {
    private DigestContracts() {}
    public enum Frequency { DAILY, WEEKLY, MUTED }
    public record Settings(Frequency frequency, List<NotificationContracts.Type> mutedCategories) {
        public Settings {
            if(frequency==null || mutedCategories==null || mutedCategories.size()>NotificationContracts.Type.values().length
                || mutedCategories.stream().anyMatch(Objects::isNull)) throw new IllegalArgumentException("Invalid digest settings");
            mutedCategories=List.copyOf(new LinkedHashSet<>(mutedCategories));
        }
        public static Settings defaults() {return new Settings(Frequency.DAILY,List.of());}
    }
    public record Preferences(UUID workspaceId, Settings settings, boolean sessionLocal) {}
    public record Item(UUID workspaceId, NotificationContracts.Type category, int count, String href) {}
    public record Digest(UUID id, Instant windowStart, Instant windowEnd, Frequency frequency, List<Item> items) {}
    public record Feed(Instant since, Instant through, List<Item> sinceLastSeen, List<Digest> digests, boolean truncated) {}
}
