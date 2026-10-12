package dev.researchhub.collaboration.infrastructure;

import dev.researchhub.ai.application.CanvasProposalContracts.Receipt;
import dev.researchhub.document.application.CanvasDocumentTarget;
import dev.researchhub.shared.error.*;

import org.springframework.stereotype.Component;

import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

@Component
public class HttpCanvasOperationBridge
        implements dev.researchhub.ai.application.CanvasOperationBridge {
    private final CollaborationProperties config;
    private final ObjectMapper json;
    private final HttpClient client =
            HttpClient.newBuilder()
                    .version(HttpClient.Version.HTTP_1_1)
                    .connectTimeout(Duration.ofSeconds(3))
                    .build();

    public HttpCanvasOperationBridge(CollaborationProperties config, ObjectMapper json) {
        this.config = config;
        this.json = json;
    }

    public Receipt apply(UUID operation, UUID document, long epoch) {
        try {
            var request =
                    HttpRequest.newBuilder(
                                    URI.create(config.getInternalUrl() + "/internal/canvas/apply"))
                            .timeout(Duration.ofSeconds(15))
                            .header("Content-Type", "application/json")
                            .header("X-Collaboration-Service-Token", config.getServiceToken())
                            .POST(
                                    HttpRequest.BodyPublishers.ofString(
                                            json.writeValueAsString(
                                                    Map.of(
                                                            "operationId",
                                                            operation,
                                                            "room",
                                                            "document:"
                                                                    + document
                                                                    + (epoch == 0
                                                                            ? ""
                                                                            : ":" + epoch)))))
                            .build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 409) throw CanvasDocumentTarget.stale("TARGET_STALE");
            if (response.statusCode() == 403)
                throw new ForbiddenException("AI acceptance permission changed");
            if (response.statusCode() != 200)
                throw new ApiException(
                        ApiErrorCode.AI_UNAVAILABLE,
                        "AI acceptance is unavailable. Retry the same operation to recover its"
                                + " receipt.");
            return json.readValue(response.body(), Receipt.class);
        } catch (ApiException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(
                    ApiErrorCode.AI_UNAVAILABLE,
                    "AI acceptance was interrupted. Retry the saved operation.");
        } catch (Exception e) {
            throw new ApiException(
                    ApiErrorCode.AI_UNAVAILABLE,
                    "AI acceptance is unavailable. Retry the saved operation.");
        }
    }
}
