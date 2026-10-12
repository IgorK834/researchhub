package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CanvasProposalContracts.Receipt;

import java.util.UUID;

/** Service-authenticated application port; it carries only a frozen operation identity. */
public interface CanvasOperationBridge {
    Receipt apply(UUID operation, UUID document, long epoch);
}
