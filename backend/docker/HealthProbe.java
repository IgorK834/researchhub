import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Readiness probe without a shell or an extra runtime package. */
public final class HealthProbe {
    public static void main(String[] args) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:"
                + System.getenv().getOrDefault("SERVER_PORT", "8080") + "/actuator/health/readiness"))
                .timeout(Duration.ofSeconds(3)).GET().build();
        try (var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            if (client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode() != 200) System.exit(1);
        }
    }
}
