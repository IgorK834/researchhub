package dev.researchhub.notification.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.notification.application.*;
import dev.researchhub.notification.application.DigestContracts.*;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/notifications/digests")
public class DigestController {
    private final DigestService service;private final CurrentUserResolver users;private final boolean local;
    public DigestController(DigestService service,CurrentUserResolver users,@Value("${researchhub.environment:local}") String environment,@Value("${researchhub.notifications.session-local-preferences:false}") boolean sessionLocal) {
        this.service=service;this.users=users;this.local=sessionLocal||environment.equals("demo");
    }
    @GetMapping public ResponseEntity<Feed> feed(HttpSession session) {
        var user=users.requireCurrentUser();
        var seen=(String)session.getAttribute("digest.seen");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.feed(user.id(),seen==null?null:Instant.parse(seen),local,local?DigestSession.preferences(session):Map.of()));
    }
    @GetMapping("/preferences") public List<Preferences> preferences(HttpSession session) {
        return service.preferences(users.requireCurrentUser().id(),local,local?DigestSession.preferences(session):Map.of());
    }
    @PutMapping("/preferences/{workspace}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void save(@PathVariable UUID workspace,@RequestBody Settings settings,HttpSession session) {
        UUID user=users.requireCurrentUser().id();service.authorize(user,workspace);
        if(!local){service.save(user,workspace,settings);return;}
        DigestSession.save(session,workspace,settings);
    }
    public record Seen(Instant through) {}
    @PostMapping("/seen") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void seen(@RequestBody Seen body,HttpSession session) {
        UUID user=users.requireCurrentUser().id();service.validateSeen(body.through());
        if(!local){service.seen(user,body.through());return;}
        String prior=(String)session.getAttribute("digest.seen");
        if(prior==null||Instant.parse(prior).isBefore(body.through()))session.setAttribute("digest.seen",body.through().toString());
    }
}
