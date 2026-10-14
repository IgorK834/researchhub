package dev.researchhub.reviewtask.application;

import dev.researchhub.audit.application.ProductAudit;
import dev.researchhub.notification.application.NotificationContracts;
import dev.researchhub.reviewtask.application.ReviewTaskContracts.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.sql.*;
import java.time.*;
import java.util.*;

@Service
public class ReviewTaskService {
    public static final int WORKSPACE_LIMIT=500;
    private final JdbcTemplate jdbc;private final WorkspaceAuthorizationService authorization;private final WorkspacePeople people;
    private final ProductAudit audit;private final Clock clock;
    public ReviewTaskService(JdbcTemplate jdbc,WorkspaceAuthorizationService authorization,WorkspacePeople people,ProductAudit audit,Clock clock) {
        this.jdbc=jdbc;this.authorization=authorization;this.people=people;this.audit=audit;this.clock=clock;
    }
    @Transactional(readOnly=true)
    public Page list(UUID workspace,UUID actor,Filter filter,UUID cursor,int limit) {
        authorization.requireContentReader(workspace,actor);
        if(limit<1 || limit>50)throw invalid("Limit must be between 1 and 50");
        if(cursor!=null)require(workspace,cursor);
        var rows=jdbc.query("""
            SELECT * FROM review_tasks WHERE workspace_id=? AND review_target_exists(workspace_id,target_type,target_id,document_id,finding_index)
            AND EXISTS(SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
              WHERE m.workspace_id=review_tasks.workspace_id AND m.user_id=? AND w.erasure_requested_at IS NULL)
            AND (?<>'MINE' OR assignee=?) AND (?<>'OPEN' OR status IN ('OPEN','IN_PROGRESS'))
            AND (?<>'OVERDUE' OR (status IN ('OPEN','IN_PROGRESS') AND due_at<?))
            AND (?::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM review_tasks WHERE workspace_id=? AND id=?))
            ORDER BY created_at DESC,id DESC LIMIT ?
            """,(r,i)->task(r),workspace,actor,filter.name(),actor,filter.name(),filter.name(),Timestamp.from(clock.instant()),cursor,workspace,cursor,limit+1);
        var items=rows.stream().limit(limit).toList();return new Page(items,rows.size()>limit ? items.getLast().id() : null);
    }
    @Transactional(readOnly=true)
    public Task get(UUID workspace,UUID actor,UUID id) {
        authorization.requireContentReader(workspace,actor);
        return jdbc.query("""
            SELECT * FROM review_tasks WHERE workspace_id=? AND id=? AND review_target_exists(workspace_id,target_type,target_id,document_id,finding_index)
            AND EXISTS(SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
              WHERE m.workspace_id=review_tasks.workspace_id AND m.user_id=? AND w.erasure_requested_at IS NULL)
            """,(r,i)->task(r),workspace,id,actor).stream().findFirst().orElseThrow(()->new ResourceNotFoundException("Review task was not found"));
    }
    @Transactional
    public Task create(UUID workspace,UUID actor,Create command) {
        people.lock(workspace,actor);authorization.requireContentEditor(workspace,actor);
        text(command.title(),command.description());
        if(command.id()==null || command.targetType()==null || command.targetId()==null)throw invalid("Task and target identities are required");
        if((command.targetType()==TargetType.COMMENT)!=(command.documentId()!=null)
            || (command.targetType()==TargetType.EVIDENCE_FINDING)!=(command.findingIndex()!=null)
            || (command.findingIndex()!=null && (command.findingIndex()<0 || command.findingIndex()>4)))throw invalid("Invalid task target");
        target(workspace,command.targetType(),command.targetId(),command.documentId(),command.findingIndex());
        assignee(workspace,command.assignee());
        var existing=jdbc.query("SELECT * FROM review_tasks WHERE workspace_id=? AND id=?",(r,i)->task(r),workspace,command.id());
        if(!existing.isEmpty()) {
            var value=existing.getFirst();
            if(!value.createdBy().equals(actor) || !value.title().equals(command.title()) || !value.description().equals(command.description())
                || value.targetType()!=command.targetType() || !value.targetId().equals(command.targetId()) || !Objects.equals(value.documentId(),command.documentId())
                || !Objects.equals(value.findingIndex(),command.findingIndex()) || !Objects.equals(value.assignee(),command.assignee()) || !Objects.equals(value.dueAt(),command.dueAt()))
                throw new ConflictException("This task id is already in use");
            return value;
        }
        if(jdbc.queryForObject("SELECT count(*) FROM review_tasks WHERE workspace_id=?",Integer.class,workspace)>=WORKSPACE_LIMIT)
            throw new ConflictException("Workspace review task limit reached (500)");
        Instant now=clock.instant();
        int inserted=jdbc.update("""
            INSERT INTO review_tasks(id,workspace_id,title,description,target_type,target_id,document_id,finding_index,assignee,status,due_at,revision,created_by,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,'OPEN',?,1,?,?,?) ON CONFLICT DO NOTHING
            """,command.id(),workspace,command.title(),command.description(),command.targetType().name(),command.targetId(),command.documentId(),command.findingIndex(),command.assignee(),time(command.dueAt()),actor,time(now),time(now));
        if(inserted!=1)throw new ConflictException("This task id is already in use");
        audit.reviewTask(workspace,actor,command.id(),command.assignee(),1,true);return require(workspace,command.id());
    }
    @Transactional
    public Task update(UUID workspace,UUID actor,UUID id,Update command) {
        people.lock(workspace,actor);authorization.requireContentEditor(workspace,actor);
        var value=require(workspace,id);if(value.revision()!=command.revision())throw new ConflictException("Task changed; reload before editing");
        text(command.title(),command.description());assignee(workspace,command.assignee());
        if(command.status()==null || !ReviewTaskContracts.transition(value.status(),command.status()))throw new ConflictException("Invalid review task status transition");
        if(value.title().equals(command.title()) && value.description().equals(command.description()) && Objects.equals(value.assignee(),command.assignee())
            && value.status()==command.status() && Objects.equals(value.dueAt(),command.dueAt()))return value;
        int changed=jdbc.update("""
            UPDATE review_tasks SET title=?,description=?,assignee=?,unassigned_reason=?,status=?,due_at=?,revision=revision+1,updated_at=?
            WHERE workspace_id=? AND id=? AND revision=?
            """,command.title(),command.description(),command.assignee(),command.assignee()==null ? "MANUAL" : null,command.status().name(),time(command.dueAt()),time(clock.instant()),workspace,id,command.revision());
        if(changed!=1)throw new ConflictException("Task changed; reload before editing");
        // One event per revision; only actionable changes fan out (never a text-only edit).
        boolean actionable=!Objects.equals(value.assignee(),command.assignee()) || !Objects.equals(value.dueAt(),command.dueAt());
        audit.reviewTask(workspace,actor,id,actionable ? command.assignee() : actor,value.revision()+1,false);
        return require(workspace,id);
    }
    private Task require(UUID workspace,UUID id) {
        return jdbc.query("SELECT * FROM review_tasks WHERE workspace_id=? AND id=? AND review_target_exists(workspace_id,target_type,target_id,document_id,finding_index)",
            (r,i)->task(r),workspace,id).stream().findFirst().orElseThrow(()->new ResourceNotFoundException("Review task was not found"));
    }
    private void target(UUID workspace,TargetType type,UUID id,UUID document,Integer finding) {
        if(!Boolean.TRUE.equals(jdbc.queryForObject("SELECT review_target_exists(?,?,?,?,?)",Boolean.class,workspace,type.name(),id,document,finding)))
            throw new ResourceNotFoundException("Review target was not found");
    }
    private void assignee(UUID workspace,UUID user) {if(user!=null && !people.current(workspace,user))throw invalid("Assignee must be a current workspace member");}
    private static void text(String title,String description) {
        if(title==null || title.isBlank() || title.length()>200 || title.codePoints().anyMatch(Character::isISOControl)
            || description==null || description.length()>4000)throw invalid("A plain text title (1–200) and description (0–4000) are required");
    }
    private static Timestamp time(Instant value) {return value==null ? null : Timestamp.from(value);}
    private static ApiException invalid(String message) {return new ApiException(ApiErrorCode.VALIDATION_FAILED,message);}
    private Task task(ResultSet r) throws SQLException {
        var type=TargetType.valueOf(r.getString("target_type"));var scope=r.getObject("workspace_id",UUID.class);var target=r.getObject("target_id",UUID.class);
        var document=r.getObject("document_id",UUID.class);Integer finding=r.getObject("finding_index",Integer.class);
        String href=type==TargetType.EVIDENCE_FINDING ? "/app/workspaces/"+scope+"/ask?evidenceAnalysis="+target+"&finding="+finding+"#evidence-finding-"+target+"-"+finding : NotificationContracts.href(scope,type.name(),target,document);
        return new Task(r.getObject("id",UUID.class),scope,r.getString("title"),r.getString("description"),type,target,document,finding,
            r.getObject("assignee",UUID.class),people.person(scope,r.getObject("assignee",UUID.class)).map(WorkspacePeople.Person::displayLabel).orElse(null),r.getString("unassigned_reason"),Status.valueOf(r.getString("status")),r.getTimestamp("due_at")==null ? null : r.getTimestamp("due_at").toInstant(),
            r.getLong("revision"),r.getObject("created_by",UUID.class),r.getTimestamp("created_at").toInstant(),r.getTimestamp("updated_at").toInstant(),href);
    }
}
