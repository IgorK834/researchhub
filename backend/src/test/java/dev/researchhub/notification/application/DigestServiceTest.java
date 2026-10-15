package dev.researchhub.notification.application;

import dev.researchhub.notification.application.DigestContracts.*;
import dev.researchhub.notification.infrastructure.PostgresDigests;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.ApiException;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class DigestServiceTest {
    PostgresDigests store=mock(PostgresDigests.class);WorkspaceAuthorizationService access=mock(WorkspaceAuthorizationService.class);
    Instant now=Instant.parse("2026-10-15T12:00:00Z");UUID user=UUID.randomUUID(),workspace=UUID.randomUUID();
    DigestService service=new DigestService(store,access,Clock.fixed(now,ZoneOffset.UTC));
    @Test void clampsCursorBoundsAggregatesAndFiltersMutedAndMismatchedWindows() {
        var workspaces=new ArrayList<UUID>();for(int i=0;i<101;i++)workspaces.add(UUID.randomUUID());when(store.workspaces(user)).thenReturn(workspaces);when(store.settings(eq(user),any())).thenReturn(Settings.defaults());
        when(store.seen(any(),any())).thenReturn(now.minus(Duration.ofDays(50)));
        when(store.items(any(),any(),any(),any())).thenAnswer(i->List.of(new Item(i.getArgument(1),NotificationContracts.Type.COMMENT,3,"/app"),new Item(i.getArgument(1),NotificationContracts.Type.MENTION,1,"/app")));
        var windows=new ArrayList<Digest>();for(int i=0;i<21;i++)windows.add(new Digest(UUID.randomUUID(),now.minusSeconds(2),now.minusSeconds(1),Frequency.DAILY,List.of()));windows.add(new Digest(UUID.randomUUID(),now.minusSeconds(10),now.minusSeconds(1),Frequency.WEEKLY,List.of()));
        when(store.published(any(),any(),any())).thenReturn(windows);
        var feed=service.feed(user,null,false,Map.of());assertEquals(now.minus(DigestService.RETENTION),feed.since());assertTrue(feed.truncated());assertEquals(100,feed.sinceLastSeen().size());assertEquals(20,feed.digests().size());
        assertEquals(100,service.preferences(user,false,Map.of()).size());assertEquals(100,service.preferences(user,true,Map.of()).size());
        when(store.workspaces(user)).thenReturn(List.of(workspace));
        var local=service.feed(user,now.minusSeconds(1),true,Map.of(workspace,new Settings(Frequency.DAILY,List.of(NotificationContracts.Type.COMMENT))));assertEquals(1,local.sinceLastSeen().size());assertEquals(NotificationContracts.Type.MENTION,local.sinceLastSeen().getFirst().category());
        assertEquals(0,service.feed(user,null,true,Map.of(workspace,new Settings(Frequency.MUTED,List.of()))).digests().size());
        when(store.items(any(),any(),any(),any())).thenReturn(List.of());assertEquals(0,service.feed(user,null,true,Map.of()).digests().size());
    }
    @Test void cursorValidationPersistenceAndDefaults() {
        for(Instant instant:Arrays.asList(null,now.plusSeconds(1),now.minus(Duration.ofDays(31))))assertThrows(ApiException.class,()->service.validateSeen(instant));
        service.seen(user,now);verify(store).see(user,now);service.save(user,workspace,Settings.defaults());service.authorize(user,workspace);verify(access,times(2)).requireContentReader(workspace,user);
        service.dispatch();verify(store).cleanup(now.minus(DigestService.RETENTION));verify(store).publish(now,now.minus(DigestService.RETENTION));
        assertThrows(IllegalArgumentException.class,()->new Settings(null,List.of()));assertThrows(IllegalArgumentException.class,()->new Settings(Frequency.DAILY,null));assertThrows(IllegalArgumentException.class,()->new Settings(Frequency.DAILY,Arrays.asList((NotificationContracts.Type)null)));
        assertThrows(IllegalArgumentException.class,()->new Settings(Frequency.DAILY,Collections.nCopies(20,NotificationContracts.Type.COMMENT)));
    }
}
