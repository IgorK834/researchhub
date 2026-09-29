package dev.researchhub.processing.infrastructure;

import dev.researchhub.processing.application.ProcessingWorkerClient;
import dev.researchhub.processing.application.WorkerDispatchException;
import dev.researchhub.processing.domain.ProcessingJob;
import dev.researchhub.processing.domain.ProcessingJobError;
import org.springframework.context.annotation.Profile;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.http.HttpClient;

/** HTTP adapter for the local Python worker. It creates a fresh internal request with no inbound user headers. */
@Component
@Profile("local")
public class HttpProcessingWorkerClient implements ProcessingWorkerClient {

    private final RestClient client;

    public HttpProcessingWorkerClient(ProcessingProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.getWorker().getRequestTimeout())
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(properties.getWorker().getRequestTimeout());
        this.client = RestClient.builder()
                .baseUrl(properties.getWorker().getBaseUrl().toString())
                .requestFactory(requestFactory)
                .build();
    }

    @Override
    public void execute(ProcessingJob job) {
        try {
            client.post()
                    .uri("/internal/jobs/source-ingest")
                    .body(WorkerJobRequest.from(job))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException rejected) {
            throw new WorkerDispatchException(new ProcessingJobError("WORKER_HTTP_ERROR",
                    "The processing worker rejected the job."), rejected);
        } catch (ResourceAccessException unavailable) {
            throw new WorkerDispatchException(new ProcessingJobError("WORKER_UNAVAILABLE",
                    "The processing worker is temporarily unavailable."), unavailable);
        } catch (RestClientException failed) {
            throw new WorkerDispatchException(new ProcessingJobError("WORKER_ERROR",
                    "The processing worker could not complete the job."), failed);
        }
    }
}
