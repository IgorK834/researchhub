package dev.researchhub.security.application;

import java.time.Duration;

public record QuotaPolicy(int userRequests, int workspaceRequests, Duration window) {
    public QuotaPolicy {
        if (userRequests < 1 || workspaceRequests < 1 || window == null
                || window.compareTo(Duration.ofSeconds(1)) < 0 || window.compareTo(Duration.ofDays(1)) > 0) {
            throw new IllegalArgumentException("Invalid costly request quota policy");
        }
    }
}
