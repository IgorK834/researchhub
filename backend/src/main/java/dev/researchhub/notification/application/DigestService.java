package dev.researchhub.notification.application;

import dev.researchhub.notification.application.DigestContracts.*;
import dev.researchhub.notification.infrastructure.PostgresDigests;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
public class DigestService {
    public static final Duration RETENTION=Duration.ofDays(30);
    private final PostgresDigests store;
    private final WorkspaceAuthorizationService access;
    private final Clock clock;
    public DigestService(PostgresDigests store,WorkspaceAuthorizationService access,Clock clock) {this.store=store;this.access=access;this.clock=clock;}
    public List<Preferences> preferences(UUID user,boolean local,Map<UUID,Settings> overrides) {
        return store.workspaces(user).stream().limit(100).map(w->new Preferences(w,local?overrides.getOrDefault(w,Settings.defaults()):store.settings(user,w),local)).toList();
    }
    @Transactional
    public void save(UUID user,UUID workspace,Settings settings) {access.requireContentReader(workspace,user);store.save(user,workspace,settings);}
    public void authorize(UUID user,UUID workspace) {access.requireContentReader(workspace,user);}
    @Transactional(readOnly=true)
    public Feed feed(UUID user,Instant sessionSeen,boolean local,Map<UUID,Settings> overrides) {
        Instant now=clock.instant(),cutoff=now.minus(RETENTION);
        Instant seen=local?(sessionSeen==null?cutoff:sessionSeen):store.seen(user,cutoff);
        if(seen.isBefore(cutoff))seen=cutoff;
        List<Item> recent=new ArrayList<>();List<Digest> digests=new ArrayList<>();boolean truncated=false;
        var workspaces=store.workspaces(user);truncated=workspaces.size()>100;
        for(UUID w:workspaces.stream().limit(100).toList()) {
            Settings pref=local?overrides.getOrDefault(w,Settings.defaults()):store.settings(user,w);
            if(pref.frequency()==Frequency.MUTED)continue;
            recent.addAll(filter(store.items(user,w,seen,now),pref));
            for(var d:store.published(user,w,cutoff)) {
                if(d.frequency()!=pref.frequency())continue;
                Instant start=d.windowStart().isBefore(cutoff)?cutoff:d.windowStart();
                var items=filter(store.items(user,w,start.minusNanos(1000),d.windowEnd().minusNanos(1000)),pref);
                if(!items.isEmpty())digests.add(new Digest(d.id(),d.windowStart(),d.windowEnd(),d.frequency(),items));
            }
        }
        digests.sort(Comparator.comparing(Digest::windowEnd).reversed().thenComparing(Digest::id));
        return new Feed(seen,now,recent.stream().limit(100).toList(),digests.stream().limit(20).toList(),truncated||recent.size()>100||digests.size()>20);
    }
    private static List<Item> filter(List<Item> items,Settings settings) {return items.stream().filter(i->!settings.mutedCategories().contains(i.category())).toList();}
    @Transactional
    public void seen(UUID user,Instant through) {validateSeen(through);store.see(user,through);}
    public void validateSeen(Instant through) {
        if(through==null || through.isAfter(clock.instant()) || through.isBefore(clock.instant().minus(RETENTION)))
            throw new ApiException(ApiErrorCode.VALIDATION_FAILED,"Invalid digest cursor");
    }
    @Transactional
    public void dispatch() {store.cleanup(clock.instant().minus(RETENTION));store.publish(clock.instant(),clock.instant().minus(RETENTION));}
}
