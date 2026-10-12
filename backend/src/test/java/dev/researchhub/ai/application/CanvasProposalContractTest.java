package dev.researchhub.ai.application;

import static org.junit.jupiter.api.Assertions.*;

import dev.researchhub.ai.application.CanvasProposalContracts.*;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.ObjectMapper;

import java.nio.file.*;
import java.util.*;

class CanvasProposalContractTest {
    final ObjectMapper json = new ObjectMapper();
    final Path root = Path.of("../contracts/ai/authoring/v2");

    @Test
    void sharedPackageAndCommandsKeepReviewedIdentityAndProviderBoundary() throws Exception {
        var p = json.readValue(Files.readString(root.resolve("proposal.json")), Proposal.class);
        assertEquals("Dodaj treść", p.text());
        assertEquals(
                p.versionHash(),
                json.readValue(Files.readString(root.resolve("accept.json")), Accept.class)
                        .versionHash());
        assertNotNull(
                json.readValue(Files.readString(root.resolve("undo.json")), Undo.class)
                        .clientOperationId());
        assertEquals(
                p.id(),
                json.readValue(Files.readString(root.resolve("receipt.json")), Receipt.class)
                        .proposalId());
        var request =
                json.readValue(
                        Files.readString(root.resolve("model-request.json")),
                        ContextContracts.ContextualRequest.class);
        var result =
                json.readValue(
                        Files.readString(root.resolve("model-result.json")),
                        AuthoringContracts.Result.class);
        result.validateFor(request.request(), AuthoringContracts.Kind.REWRITE, false);
        assertEquals(
                p.id(),
                json.readValue(
                                Files.readString(root.resolve("result.json")),
                                CanvasConversationContracts.CanvasResult.class)
                        .proposalId());
        assertThrows(IllegalArgumentException.class, () -> new Accept(null, "a".repeat(64)));
        assertThrows(
                IllegalArgumentException.class, () -> new Accept(UUID.randomUUID(), "invalid"));
        assertThrows(IllegalArgumentException.class, () -> new Undo(null));
        assertThrows(
                IllegalArgumentException.class,
                () ->
                        new CanvasConversationContracts.CanvasResult(
                                "EDIT_PROPOSAL", UUID.randomUUID(), UUID.randomUUID(), "invalid"));
        assertThrows(
                IllegalArgumentException.class,
                () -> new CanvasConversationContracts.CanvasResult("EDIT_PROPOSAL", null, "bad"));
        assertThrows(
                IllegalArgumentException.class,
                () -> new CanvasConversationContracts.CanvasResult("SYSTEM", p.id(), "bad"));
    }

    @Test
    void routerHasOnlyExplicitApplicationRoutesAndClarificationWins() {
        var router = new CanvasIntentRouter();
        assertInstanceOf(
                CanvasIntentRouter.Answer.class,
                router.route(CanvasConversationContracts.Intent.ANSWER, null));
        assertInstanceOf(
                CanvasIntentRouter.Answer.class,
                router.route(CanvasConversationContracts.Intent.CLARIFY, null));
        assertInstanceOf(
                CanvasIntentRouter.Edit.class,
                router.route(CanvasConversationContracts.Intent.EDIT, null));
        assertInstanceOf(
                CanvasIntentRouter.Dataset.class,
                router.route(CanvasConversationContracts.Intent.ANALYZE, null));
        assertInstanceOf(
                CanvasIntentRouter.Problem.class,
                router.route(CanvasConversationContracts.Intent.SOLVE, null));
        assertEquals(
                "Choose an explicit reference",
                ((CanvasIntentRouter.Clarify)
                                router.route(
                                        CanvasConversationContracts.Intent.EDIT,
                                        "Choose an explicit reference"))
                        .message());
    }
}
