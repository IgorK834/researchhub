package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.ProcessingWorkerClient;
import dev.researchhub.processing.application.SourceIngestInput;
import dev.researchhub.processing.application.SourceIngestInputProvider;
import dev.researchhub.processing.application.WorkerDispatchException;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobError;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;

/** Authenticated HTTP adapter. It creates a fresh request and never forwards an end-user request or token. */
@Component
@Profile("local")
public class HttpProcessingWorkerClient implements ProcessingWorkerClient {

    private static final ProcessingJobError REJECTED = new ProcessingJobError("WORKER_HTTP_ERROR",
            "The processing worker rejected the job.");
    private static final ProcessingJobError UNAVAILABLE = new ProcessingJobError("WORKER_UNAVAILABLE",
            "The processing worker is temporarily unavailable.");
    private static final ProcessingJobError CONTRACT_ERROR = new ProcessingJobError("WORKER_CONTRACT_ERROR",
            "The processing worker returned an invalid result.");
    private static final ProcessingJobError WORKER_ERROR = new ProcessingJobError("WORKER_ERROR",
            "The processing worker could not complete the job.");

    private final RestClient client;
    private final ObjectMapper objectMapper;
    private final SourceIngestInputProvider inputs;
    private final ProcessingProperties.Worker policy;

    public HttpProcessingWorkerClient(ProcessingProperties properties, ObjectMapper objectMapper,
                                      SourceIngestInputProvider inputs) {
        this.policy = properties.getWorker();
        this.objectMapper = objectMapper;
        this.inputs = inputs;
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(policy.getRequestTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(policy.getRequestTimeout());
        this.client = RestClient.builder()
                .baseUrl(policy.getBaseUrl().toString())
                .requestFactory(requestFactory)
                .build();
    }

    @Override
    public void execute(ProcessingJob job) {
        try {
            SourceIngestInput input = inputs.resolve(job.workspaceId(), job.resourceId(), policy.getSourceAccessTtl());
            WorkerJobRequest request = WorkerJobRequest.from(job, input);
            WorkerJobResult result = client.post()
                    .uri("/internal/jobs/source-ingest")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + policy.getServiceToken())
                    .body(request)
                    .exchange((_sent, response) -> readResult(response.getStatusCode().is2xxSuccessful(),
                            response.getBody()));
            if (result == null) {
                throw new InvalidWorkerContractException("Worker returned no result");
            }
            result.validateFor(job);
            ProcessingJobError failure = result.safeFailure();
            if (failure != null) {
                throw new WorkerDispatchException(failure, null);
            }
        } catch (WorkerDispatchException safe) {
            throw safe;
        } catch (WorkerRejectedException rejected) {
            throw new WorkerDispatchException(REJECTED, rejected);
        } catch (InvalidWorkerContractException | IllegalArgumentException invalid) {
            throw new WorkerDispatchException(CONTRACT_ERROR, invalid);
        } catch (ResourceAccessException unavailable) {
            throw new WorkerDispatchException(UNAVAILABLE, unavailable);
        } catch (RestClientException failed) {
            throw new WorkerDispatchException(WORKER_ERROR, failed);
        } catch (RuntimeException failed) {
            throw new WorkerDispatchException(WORKER_ERROR, failed);
        }
    }

    private WorkerJobResult readResult(boolean success, InputStream body) {
        if (!success) {
            throw new WorkerRejectedException();
        }
        if (body == null) {
            throw new InvalidWorkerContractException("Worker returned no response body");
        }
        try (body) {
            byte[] bytes = body.readNBytes(WorkerJobResult.MAX_RESPONSE_BYTES + 1);
            if (bytes.length > WorkerJobResult.MAX_RESPONSE_BYTES) {
                throw new InvalidWorkerContractException("Worker response is too large");
            }
            return objectMapper.readerFor(WorkerJobResult.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(bytes);
        } catch (IOException invalid) {
            throw new InvalidWorkerContractException("Worker response is not valid JSON", invalid);
        }
    }

    private static final class WorkerRejectedException extends RuntimeException {
    }

    private static final class InvalidWorkerContractException extends RuntimeException {
        private InvalidWorkerContractException(String message) {
            super(message);
        }

        private InvalidWorkerContractException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
