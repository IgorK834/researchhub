package dev.researchhub.notification.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class NotificationContracts {
    private NotificationContracts() {}
    public enum Type { COMMENT, MENTION, ANALYSIS_COMPLETED, ANALYSIS_FAILED, REVIEW_TASK, ATTENTION }
    public record Notification(UUID id, UUID eventId, UUID workspaceId, Type type, String targetType,
                               UUID targetId, UUID documentId, Instant createdAt, Instant readAt, String href, String workspaceLabel, String targetLabel) {}
    public record Page(List<Notification> items, String nextCursor, int unreadCount, boolean countCapped) {}
    public record Cursor(Instant time, UUID id) {}
    public record Preference(Type type, boolean muted) {}
    public static String href(UUID workspace, String type, UUID target, UUID document) {
        String base="/app/workspaces/"+workspace;
        return switch(type) {
            case "COMMENT" -> base+"/documents/"+document+"?comment="+target+"#comment-"+target;
            case "DOCUMENT" -> base+"/documents/"+target;
            case "ANALYSIS" -> base+"/analyses/"+target;
            case "REVIEW_TASK" -> base+"/review-tasks?task="+target+"#review-task-"+target;
            default -> base;
        };
    }
}
