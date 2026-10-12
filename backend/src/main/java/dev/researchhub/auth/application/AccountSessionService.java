package dev.researchhub.auth.application;

import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.security.application.SecureTokens;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.*;

/** Principal-scoped repository lookup is the only path to session management. */
@Service
public class AccountSessionService {
    public static final String HANDLE_ATTRIBUTE="RESEARCHHUB_SESSION_HANDLE";
    public static final String AGENT_ATTRIBUTE="RESEARCHHUB_SESSION_AGENT";
    public record Summary(String handle,Instant createdAt,Instant lastAccessedAt,String userAgent,boolean current) {}
    private final ObjectProvider<FindByIndexNameSessionRepository<? extends Session>> repositories;
    public AccountSessionService(ObjectProvider<FindByIndexNameSessionRepository<? extends Session>> repositories) { this.repositories=repositories; }
    public List<Summary> list(UUID user,String currentId) { return list(repository(),user,currentId); }
    private static <S extends Session> List<Summary> list(FindByIndexNameSessionRepository<S> repository,UUID user,String currentId) {
        var result=new ArrayList<Summary>();
        for (S session:repository.findByPrincipalName(user.toString()).values()) {
            if (session.isExpired()) continue;
            String handle=session.getAttribute(HANDLE_ATTRIBUTE);
            if (!SecureTokens.valid(handle)) { handle=SecureTokens.create(); session.setAttribute(HANDLE_ATTRIBUTE,handle); repository.save(session); }
            String agent=session.getAttribute(AGENT_ATTRIBUTE);
            result.add(new Summary(handle,session.getCreationTime(),session.getLastAccessedTime(),agent==null?"Unknown browser":agent,session.getId().equals(currentId)));
        }
        result.sort(Comparator.comparing(Summary::lastAccessedAt).reversed()); return List.copyOf(result);
    }
    /** Returns whether the revoked session belongs to the current HTTP request. */
    public boolean revoke(UUID user,String handle,String currentId) {
        var repository=repository();
        for (var session:repository.findByPrincipalName(user.toString()).values()) {
            if (!session.isExpired() && SecureTokens.valid(handle) && handle.equals(session.getAttribute(HANDLE_ATTRIBUTE))) {
                repository.deleteById(session.getId()); return session.getId().equals(currentId);
            }
        }
        throw new ResourceNotFoundException("Session was not found");
    }
    public void revokeAll(UUID user,String keepId) {
        var repository=repository();
        for (var session:repository.findByPrincipalName(user.toString()).values())
            if (!session.getId().equals(keepId)) repository.deleteById(session.getId());
    }
    private FindByIndexNameSessionRepository<? extends Session> repository() {
        var repository=repositories.getIfAvailable();
        if (repository==null) throw new ConflictException("Account session management requires the JDBC session store");
        return repository;
    }
    public static String agentSummary(String agent) {
        if (agent==null) return "Unknown browser";
        String browser=agent.contains("Edg/")?"Edge":agent.contains("Firefox/")?"Firefox":agent.contains("Chrome/")?"Chrome":agent.contains("Safari/")?"Safari":"Other browser";
        String platform=agent.contains("Android")?"Android":agent.contains("iPhone")||agent.contains("iPad")?"iOS":agent.contains("Windows")?"Windows":agent.contains("Macintosh")?"macOS":agent.contains("Linux")?"Linux":"Unknown device";
        return browser+" · "+platform;
    }
}
