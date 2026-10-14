package dev.researchhub.reviewtask.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ReviewTaskContracts {
    private ReviewTaskContracts() {}
    public enum Status { OPEN, IN_PROGRESS, DONE, CANCELLED }
    public enum TargetType { COMMENT, DOCUMENT, ANALYSIS, EVIDENCE_FINDING }
    public enum Filter { ALL, MINE, OPEN, OVERDUE }
    public record Create(UUID id,String title,String description,TargetType targetType,UUID targetId,UUID documentId,Integer findingIndex,UUID assignee,Instant dueAt) {}
    public record Update(long revision,String title,String description,UUID assignee,Status status,Instant dueAt) {}
    public record Task(UUID id,UUID workspaceId,String title,String description,TargetType targetType,UUID targetId,UUID documentId,Integer findingIndex,
                       UUID assignee,String assigneeLabel,String unassignedReason,Status status,Instant dueAt,long revision,UUID createdBy,Instant createdAt,Instant updatedAt,String href) {}
    public record Page(List<Task> items,UUID nextCursor) {}
    public static boolean transition(Status from,Status to) {
        if(from==to)return true;
        return switch(from) {
            case OPEN -> to==Status.IN_PROGRESS || to==Status.DONE || to==Status.CANCELLED;
            case IN_PROGRESS -> to==Status.OPEN || to==Status.DONE || to==Status.CANCELLED;
            case DONE,CANCELLED -> to==Status.OPEN;
        };
    }
}
