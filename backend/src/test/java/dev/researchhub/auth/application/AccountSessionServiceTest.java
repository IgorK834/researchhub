package dev.researchhub.auth.application;

import dev.researchhub.security.application.SecureTokens;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.session.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountSessionServiceTest {
    static class Store implements FindByIndexNameSessionRepository<MapSession> {
        final Map<String,MapSession> rows=new LinkedHashMap<>();
        public MapSession createSession() { return new MapSession(); }
        public void save(MapSession s) { rows.put(s.getId(),s); }
        public MapSession findById(String id) { return rows.get(id); }
        public void deleteById(String id) { rows.remove(id); }
        public Map<String,MapSession> findByIndexNameAndIndexValue(String name,String principal) {
            var result=new LinkedHashMap<String,MapSession>();for(var s:rows.values()) if(principal.equals(s.getAttribute(PRINCIPAL_NAME_INDEX_NAME)))result.put(s.getId(),s);return result;
        }
        MapSession add(UUID user,boolean handle) {
            var s=createSession();s.setAttribute(PRINCIPAL_NAME_INDEX_NAME,user.toString());
            if(handle)s.setAttribute(AccountSessionService.HANDLE_ATTRIBUTE,SecureTokens.create());save(s);return s;
        }
    }
    @SuppressWarnings("unchecked") AccountSessionService service(Store store) {
        ObjectProvider<FindByIndexNameSessionRepository<? extends Session>> provider=mock(ObjectProvider.class);
        doReturn(store).when(provider).getIfAvailable();return new AccountSessionService(provider);
    }
    @Test void legacySessionsGetStableOpaqueHandlesAndEveryLookupIsPrincipalScoped() {
        var store=new Store();var user=UUID.randomUUID();var other=UUID.randomUUID();var current=store.add(user,false);var expired=store.add(user,true);
        expired.setLastAccessedTime(Instant.EPOCH);expired.setMaxInactiveInterval(Duration.ofSeconds(1));store.add(other,true);
        var service=service(store);var rows=service.list(user,current.getId());assertEquals(1,rows.size());assertTrue(rows.getFirst().current());
        assertEquals("Unknown browser",rows.getFirst().userAgent());assertTrue(SecureTokens.valid(rows.getFirst().handle()));
        assertEquals(rows,service.list(user,current.getId()));assertThrows(ResourceNotFoundException.class,()->service.revoke(other,rows.getFirst().handle(),null));
        assertThrows(ResourceNotFoundException.class,()->service.revoke(user,"bad",null));
        assertTrue(service.revoke(user,rows.getFirst().handle(),current.getId()));assertEquals(0,service.list(user,null).size());
    }
    @Test void revokeAllCanKeepCurrentSessionAndLeavesOtherPrincipalsUntouched() {
        var store=new Store();var user=UUID.randomUUID();var other=UUID.randomUUID();var keep=store.add(user,true);store.add(user,true);store.add(other,true);
        keep.setAttribute(AccountSessionService.AGENT_ATTRIBUTE,"Firefox · Linux");var service=service(store);
        assertEquals("Firefox · Linux",service.list(user,keep.getId()).stream().filter(AccountSessionService.Summary::current).findFirst().orElseThrow().userAgent());service.revokeAll(user,keep.getId());assertEquals(2,store.rows.size());
        assertFalse(service.revoke(user,keep.getAttribute(AccountSessionService.HANDLE_ATTRIBUTE),null));assertEquals(1,store.rows.size());
        assertEquals(1,service.list(other,null).size());service.revokeAll(other,null);assertTrue(store.rows.isEmpty());
    }
    @Test void servletFallbackDoesNotPretendToProvideGlobalRevocation() { assertThrows(ConflictException.class,()->service(null).list(UUID.randomUUID(),null)); }
    @Test void agentSummariesNeverContainSubmittedPersonalData() {
        assertEquals("Unknown browser",AccountSessionService.agentSummary(null));
        String[][] agents={{"Edg/ Windows","Edge · Windows"},{"Firefox/ Linux","Firefox · Linux"},{"Chrome/ Android","Chrome · Android"},
            {"Safari/ Macintosh","Safari · macOS"},{"Safari/ iPhone","Safari · iOS"},{"Safari/ iPad","Safari · iOS"},{"private payload","Other browser · Unknown device"}};
        for(var agent:agents)assertEquals(agent[1],AccountSessionService.agentSummary(agent[0]));
    }
}
