package dev.researchhub.notification.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.notification.application.NotificationContracts.*;
import dev.researchhub.notification.application.NotificationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    public record ReadAll(@NotNull Instant before,@Min(1) @Max(100) int limit) {}
    public record Mute(@NotNull Type type,boolean muted) {}
    @org.springframework.beans.factory.annotation.Value("${researchhub.environment:local}") private String environment;
    @org.springframework.beans.factory.annotation.Value("${researchhub.notifications.session-local-preferences:false}") private boolean sessionLocal;
    private final NotificationService service;private final CurrentUserResolver users;
    public NotificationController(NotificationService service,CurrentUserResolver users) {this.service=service;this.users=users;}
    @GetMapping public Page list(@RequestParam(required=false) String cursor,@RequestParam(defaultValue="20") int limit,
        @RequestParam(defaultValue="false") boolean unread,@RequestParam(required=false) Type type) {
        return service.list(caller(),cursor,limit,unread,type);
    }
    @PostMapping("/{id}/read") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@PathVariable UUID id) {service.read(caller(),id);}
    @PostMapping("/read-all") public Map<String,Integer> readAll(@Valid @RequestBody ReadAll request) {
        return Map.of("updated",service.readAll(caller(),request.before(),request.limit()));
    }
    @GetMapping("/preferences/{workspaceId}") public List<Preference> preferences(@PathVariable UUID workspaceId,jakarta.servlet.http.HttpSession session) {
        var existing=service.preferences(caller(),workspaceId);
        if(!sessionLocal&&!"demo".equals(environment))return existing;
        return localPreferences(session,workspaceId).stream().map(t->new Preference(t,true)).toList();
    }
    @PutMapping("/preferences/{workspaceId}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void mute(@PathVariable UUID workspaceId,@Valid @RequestBody Mute request,jakarta.servlet.http.HttpSession session) {
        if(!sessionLocal&&!"demo".equals(environment)){service.preference(caller(),workspaceId,request.type(),request.muted());return;}
        service.preferences(caller(),workspaceId);
        var types=new HashSet<>(localPreferences(session,workspaceId));
        if(request.muted())types.add(request.type());else types.remove(request.type());
        var prior=DigestSession.preferences(session).getOrDefault(workspaceId,dev.researchhub.notification.application.DigestContracts.Settings.defaults());
        DigestSession.save(session,workspaceId,new dev.researchhub.notification.application.DigestContracts.Settings(prior.frequency(),List.copyOf(types)));
    }
    private List<Type> localPreferences(jakarta.servlet.http.HttpSession session,UUID workspace) {
        return DigestSession.preferences(session).getOrDefault(workspace,dev.researchhub.notification.application.DigestContracts.Settings.defaults()).mutedCategories();
    }
    private UUID caller() {return users.requireCurrentUser().id();}
}
