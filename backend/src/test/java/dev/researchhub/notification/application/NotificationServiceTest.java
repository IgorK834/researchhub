package dev.researchhub.notification.application;

import dev.researchhub.notification.application.NotificationContracts.*;
import dev.researchhub.notification.infrastructure.PostgresNotifications;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class NotificationServiceTest {
    final UUID user=UUID.randomUUID(),workspace=UUID.randomUUID(),id=UUID.randomUUID();
    final Instant now=Instant.parse("2026-10-14T10:00:00Z");
    final PostgresNotifications store=mock(PostgresNotifications.class);
    final WorkspaceAuthorizationService auth=mock(WorkspaceAuthorizationService.class);
    final NotificationService service=new NotificationService(store,auth,Clock.fixed(now,ZoneOffset.UTC));
    @Test void capsCountsValidatesLimitsAndScopesCursorToTheUserAndFilter() {
        var item=new Notification(id,id,workspace,Type.COMMENT,"COMMENT",id,id,now,null,"target","Workspace","Document");
        when(store.page(eq(user),any(),eq(2),eq(false),isNull(),any())).thenReturn(List.of(item,item));when(store.unread(eq(user),any())).thenReturn(1001);
        var result=service.list(user,null,1,false,null);assertEquals(1000,result.unreadCount());assertTrue(result.countCapped());assertNotNull(result.nextCursor());
        assertEquals(new Cursor(now,id),NotificationService.decode(result.nextCursor(),user+":false:null"));
        assertNull(NotificationService.decode(" ","scope"));
        for(String cursor:List.of("!invalid", "x".repeat(513),base64("scope|bad|"+id),base64("scope|"+now+"|bad"),base64("wrong|"+now+"|"+id),base64("scope")))
            assertThrows(ApiException.class,()->NotificationService.decode(cursor,"scope"));
        assertThrows(ApiException.class,()->service.list(user,null,0,false,null));assertThrows(ApiException.class,()->service.list(user,null,51,false,null));
    }
    @Test void readAllIsBoundedAndOnlyTheOwnerCanReadOrChangePreferences() {
        assertThrows(ResourceNotFoundException.class,()->service.read(user,id));when(store.read(eq(user),eq(id),any(),any())).thenReturn(true);service.read(user,id);
        assertThrows(ApiException.class,()->service.readAll(user,null,1));assertThrows(ApiException.class,()->service.readAll(user,now.plusSeconds(1),1));assertThrows(ApiException.class,()->service.readAll(user,now,0));
        when(store.readAll(eq(user),eq(now),eq(100),any(),any())).thenReturn(4);assertEquals(4,service.readAll(user,now,100));
        service.preferences(user,workspace);service.preference(user,workspace,Type.MENTION,true);verify(auth,times(2)).requireContentReader(workspace,user);verify(store).preference(user,workspace,Type.MENTION,true);
    }
    @Test void linksReferToProtectedTargetsAndNeverCarryBodiesOrPrompts() {
        for(String type:List.of("COMMENT","DOCUMENT","ANALYSIS","REVIEW_TASK","WORKSPACE"))assertTrue(NotificationContracts.href(workspace,type,id,id).startsWith("/app/workspaces/"+workspace));
    }
    static String base64(String value) {return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
}
