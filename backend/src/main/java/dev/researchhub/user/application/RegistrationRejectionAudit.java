package dev.researchhub.user.application;

/** Rejections have no account/workspace yet. Never pass an email, address, token or request body. */
public interface RegistrationRejectionAudit {
    void rejected(String requestId, String mode);
}
