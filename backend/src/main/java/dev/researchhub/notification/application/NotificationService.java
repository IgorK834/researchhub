package dev.researchhub.notification.application;

import dev.researchhub.notification.application.NotificationContracts.*;
import dev.researchhub.notification.infrastructure.PostgresNotifications;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

@Service
public class NotificationService {
    public static final Duration RETENTION=Duration.ofDays(90);
    private final PostgresNotifications store;
    private final WorkspaceAuthorizationService authorization;
    private final Clock clock;
    public NotificationService(PostgresNotifications store,WorkspaceAuthorizationService authorization,Clock clock) {
        this.store=store;this.authorization=authorization;this.clock=clock;
    }
    @Transactional(readOnly=true)
    public Page list(UUID user,String cursor,int limit,boolean unread,Type type) {
        bound(limit,50);
        String scope=user+":"+unread+":"+type;
        Cursor decoded=decode(cursor,scope);
        var rows=store.page(user,decoded,limit+1,unread,type,clock.instant().minus(RETENTION));
        var items=rows.stream().limit(limit).toList();
        int count=store.unread(user,clock.instant().minus(RETENTION));
        String next=rows.size()>limit ? encode(scope,items.getLast()) : null;
        return new Page(items,next,Math.min(count,1000),count>1000);
    }
    @Transactional
    public void read(UUID user,UUID id) {
        if(!store.read(user,id,clock.instant(),clock.instant().minus(RETENTION))) throw new ResourceNotFoundException("Notification was not found");
    }
    @Transactional
    public int readAll(UUID user,Instant before,int limit) {
        bound(limit,100);
        if(before==null || before.isAfter(clock.instant())) throw invalid("A past read boundary is required");
        return store.readAll(user,before,limit,clock.instant(),clock.instant().minus(RETENTION));
    }
    @Transactional(readOnly=true)
    public List<Preference> preferences(UUID user,UUID workspace) {
        authorization.requireContentReader(workspace,user);return store.preferences(user,workspace);
    }
    @Transactional
    public void preference(UUID user,UUID workspace,Type type,boolean muted) {
        authorization.requireContentReader(workspace,user);store.preference(user,workspace,Objects.requireNonNull(type),muted);
    }
    private static String encode(String scope,Notification last) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString((scope+"|"+last.createdAt()+"|"+last.id()).getBytes(StandardCharsets.UTF_8));
    }
    static Cursor decode(String value,String scope) {
        if(value==null || value.isBlank())return null;
        try {
            if(value.length()>512)throw new IllegalArgumentException();
            String[] parts=new String(Base64.getUrlDecoder().decode(value),StandardCharsets.UTF_8).split("\\|",-1);
            if(parts.length!=3 || !parts[0].equals(scope))throw new IllegalArgumentException();
            return new Cursor(Instant.parse(parts[1]),UUID.fromString(parts[2]));
        } catch(IllegalArgumentException | java.time.format.DateTimeParseException e) {throw invalid("Invalid notification cursor");}
    }
    private static void bound(int limit,int max) {if(limit<1 || limit>max)throw invalid("Limit must be between 1 and "+max);}
    private static ApiException invalid(String message) {return new ApiException(ApiErrorCode.VALIDATION_FAILED,message);}
}
