package dev.researchhub.collaboration.infrastructure;

import dev.researchhub.document.application.CanvasTargets.*;
import dev.researchhub.document.application.CanvasPositionResolver;
import dev.researchhub.document.application.DocumentSnapshotState;
import dev.researchhub.document.application.CanvasDocumentTarget;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

@Component
public final class HttpCanvasPositionResolver implements CanvasPositionResolver {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(HttpCanvasPositionResolver.class);
    private final CollaborationProperties config; private final ObjectMapper json;
    // Hocuspocus owns HTTP upgrade handling for WebSockets and does not support h2c upgrades.
    private final HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
    public HttpCanvasPositionResolver(CollaborationProperties config,ObjectMapper json) { this.config=config;this.json=json; }
    @Override public Resolution pin(DocumentSnapshotState.State state,Target target) {
        return call(state,null,null,target);
    }
    @Override public Resolution resolve(DocumentSnapshotState.State state,Relative relative,String stateVector) {
        return call(state,relative,stateVector,null);
    }
    private Resolution call(DocumentSnapshotState.State state,Relative relative,String stateVector,Target target) {
        try {
            var body=new LinkedHashMap<String,Object>();body.put("state",Base64.getEncoder().encodeToString(state.bytes()));
            body.put("relative",relative);body.put("stateVector",stateVector);body.put("target",target);
            var request=HttpRequest.newBuilder(URI.create(config.getInternalUrl()+"/internal/canvas/resolve"))
                .timeout(Duration.ofSeconds(5)).header("Content-Type","application/json")
                .header("X-Collaboration-Service-Token",config.getServiceToken())
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()==409) throw CanvasDocumentTarget.stale("TARGET_STALE");
            if(response.statusCode()!=200) {
                log.warn("Canvas position verification returned HTTP {}",response.statusCode());
                throw new ApiException(ApiErrorCode.AI_UNAVAILABLE,"Document context verification is unavailable");
            }
            var result=json.readValue(response.body(),Resolution.class);
            if(result==null || result.start()==null || result.end()==null)
                throw new ApiException(ApiErrorCode.AI_UNAVAILABLE,"Document context verification is unavailable");
            return result;
        } catch(ApiException e) { throw e; }
        catch(InterruptedException e) { Thread.currentThread().interrupt();throw new ApiException(ApiErrorCode.AI_UNAVAILABLE,"Document context verification was interrupted"); }
        catch(Exception e) {
            log.warn("Canvas position verification failed ({})",e.getClass().getSimpleName());
            throw new ApiException(ApiErrorCode.AI_UNAVAILABLE,"Document context verification is unavailable");
        }
    }
}
