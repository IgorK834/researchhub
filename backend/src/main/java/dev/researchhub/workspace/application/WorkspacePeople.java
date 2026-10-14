package dev.researchhub.workspace.application;

import dev.researchhub.shared.error.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/** Small workspace-only directory. No email or global account search crosses this boundary. */
@Service
public class WorkspacePeople {
    public record Person(UUID userId,String displayLabel) {}
    private final JdbcTemplate jdbc;
    private final WorkspaceAuthorizationService authorization;
    public WorkspacePeople(JdbcTemplate jdbc,WorkspaceAuthorizationService authorization) {this.jdbc=jdbc;this.authorization=authorization;}
    @Transactional(readOnly=true)
    public List<Person> search(UUID workspace,UUID actor,String query) {
        authorization.requireContentReader(workspace,actor);
        if(query==null || query.length()>80 || query.codePoints().anyMatch(Character::isISOControl))throw invalid();
        return jdbc.query("""
            SELECT m.user_id,u.display_name FROM workspace_members m JOIN users u ON u.id=m.user_id
            WHERE m.workspace_id=? AND u.status='ACTIVE' AND position(lower(?) in lower(u.display_name))>0
            AND EXISTS(SELECT 1 FROM workspace_members actor JOIN workspaces w ON w.id=actor.workspace_id
              WHERE actor.workspace_id=m.workspace_id AND actor.user_id=? AND w.erasure_requested_at IS NULL)
            ORDER BY lower(u.display_name),m.user_id LIMIT 10
            """,(r,i)->new Person(r.getObject(1,UUID.class),r.getString(2)),workspace,query.strip(),actor);
    }
    /** All recipient validations and quota admission share the membership-mutation lock. */
    public void lock(UUID workspace,UUID actor) {
        authorization.requireContentReader(workspace,actor);
        jdbc.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE",(r,i)->r.getObject(1,UUID.class),workspace);
        if(!current(workspace,actor))throw new ResourceNotFoundException("Workspace was not found");
    }
    public boolean current(UUID workspace,UUID user) {return person(workspace,user).isPresent();}
    public Optional<Person> person(UUID workspace,UUID user) {
        return jdbc.query("""
            SELECT m.user_id,u.display_name FROM workspace_members m JOIN users u ON u.id=m.user_id
            WHERE m.workspace_id=? AND m.user_id=? AND u.status='ACTIVE'
            """,(r,i)->new Person(r.getObject(1,UUID.class),r.getString(2)),workspace,user).stream().findFirst();
    }
    private static ApiException invalid() {return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Member query must be at most 80 characters without control characters");}
}
