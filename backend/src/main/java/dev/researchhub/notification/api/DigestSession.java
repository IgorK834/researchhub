package dev.researchhub.notification.api;

import dev.researchhub.notification.application.DigestContracts.*;
import dev.researchhub.notification.application.NotificationContracts;
import jakarta.servlet.http.HttpSession;
import java.util.*;

/** String-only session storage keeps shared demo preferences isolated and Spring Session serializable. */
final class DigestSession {
    private DigestSession() {}
    @SuppressWarnings("unchecked")
    static Map<UUID,Settings> preferences(HttpSession session) {
        var result=new HashMap<UUID,Settings>();
        var raw=(Map<String,String>)session.getAttribute("digest.preferences");
        if(raw!=null)raw.forEach((w,v)->{var values=v.split(":",-1);result.put(UUID.fromString(w),new Settings(Frequency.valueOf(values[0]),values[1].isEmpty()?List.of():Arrays.stream(values[1].split(",")).map(NotificationContracts.Type::valueOf).toList()));});
        return result;
    }
    static void save(HttpSession session,UUID workspace,Settings settings) {
        var values=preferences(session);values.put(workspace,settings);
        Map<String,String> raw=new HashMap<>();values.forEach((w,s)->raw.put(w.toString(),s.frequency()+":"+String.join(",",s.mutedCategories().stream().map(Enum::name).toList())));
        session.setAttribute("digest.preferences",raw);
    }
}
