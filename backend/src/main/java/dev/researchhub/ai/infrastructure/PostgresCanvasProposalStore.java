package dev.researchhub.ai.infrastructure;

import dev.researchhub.ai.application.CanvasProposalContracts.*;
import dev.researchhub.shared.error.*;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.ObjectMapper;

import java.util.*;

@Repository
public class PostgresCanvasProposalStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public PostgresCanvasProposalStore(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public Optional<Proposal> lookup(UUID workspace, UUID document, UUID id, boolean lock) {
        return jdbc
                .query(
                        "SELECT payload,state,operation_id,(SELECT id FROM canvas_operations o"
                                + " WHERE o.source_operation_id=p.operation_id AND o.receipt IS NOT"
                                + " NULL LIMIT 1) AS compensation_id FROM canvas_proposals p WHERE"
                                + " workspace_id=? AND document_id=? AND id=?"
                                + (lock ? " FOR UPDATE OF p" : ""),
                        (r, i) -> {
                            var p = json.readValue(r.getString(1), Proposal.class);
                            return new Proposal(
                                    p.schemaVersion(),
                                    p.id(),
                                    p.workspaceId(),
                                    p.documentId(),
                                    p.contextId(),
                                    p.turnId(),
                                    p.supersedes(),
                                    p.mode(),
                                    r.getString(2),
                                    p.versionHash(),
                                    p.originalText(),
                                    p.paragraphs(),
                                    p.citations(),
                                    p.warnings(),
                                    p.generation(),
                                    p.modelContext(),
                                    p.createdAt(),
                                    r.getObject(3, UUID.class),
                                    r.getObject(4, UUID.class),p.calculation());
                        },
                        workspace,
                        document,
                        id)
                .stream()
                .findFirst();
    }

    public Proposal find(UUID workspace, UUID document, UUID id, boolean lock) {
        return lookup(workspace, document, id, lock)
                .orElseThrow(() -> new ResourceNotFoundException("Canvas proposal was not found"));
    }

    public Optional<Proposal> reference(UUID workspace, UUID document, UUID id) {
        var direct = lookup(workspace, document, id, false);
        if (direct.isPresent()) return direct;
        var ids =
                jdbc.queryForList(
                        "SELECT id FROM canvas_proposals WHERE workspace_id=? AND document_id=? AND"
                                + " operation_id=?",
                        UUID.class,
                        workspace,
                        document,
                        id);
        return ids.stream().findFirst().flatMap(value -> lookup(workspace, document, value, false));
    }

    public void save(Proposal p) {
        if (p.supersedes() != null
                && jdbc.update(
                                "UPDATE canvas_proposals SET state='SUPERSEDED' WHERE"
                                        + " workspace_id=? AND document_id=? AND id=? AND"
                                        + " state='PENDING'",
                                p.workspaceId(),
                                p.documentId(),
                                p.supersedes())
                        != 1)
            throw new ConflictException("The previous proposal is no longer pending");
        jdbc.update(
                "INSERT INTO"
                    + " canvas_proposals(id,workspace_id,document_id,context_id,turn_id,supersedes,state,payload)"
                    + " VALUES(?,?,?,?,?,?,'PENDING',?::jsonb)",
                p.id(),
                p.workspaceId(),
                p.documentId(),
                p.contextId(),
                p.turnId(),
                p.supersedes(),
                json.writeValueAsString(p));
    }

    public void reject(UUID workspace, UUID id) {
        jdbc.update(
                "UPDATE canvas_proposals SET state='REJECTED' WHERE workspace_id=? AND id=? AND"
                        + " state='PENDING'",
                workspace,
                id);
    }

    public void accepted(UUID workspace, UUID id, UUID operation) {
        jdbc.update(
                "UPDATE canvas_proposals SET state='ACCEPTED',operation_id=? WHERE workspace_id=?"
                        + " AND id=?",
                operation,
                workspace,
                id);
    }

    public void operation(Operation op, String hash) {
        jdbc.update(
                "INSERT INTO"
                    + " canvas_operations(id,workspace_id,document_id,caller_id,proposal_id,kind,source_operation_id,request_hash,epoch)"
                    + " VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                op.id(),
                op.workspaceId(),
                op.documentId(),
                op.callerId(),
                op.proposalId(),
                op.kind(),
                op.sourceOperationId(),
                hash,
                op.epoch());
        var saved = operation(op.id(), true);
        String actual =
                jdbc.queryForObject(
                        "SELECT request_hash FROM canvas_operations WHERE id=?",
                        String.class,
                        op.id());
        if (!hash.equals(actual)
                || !saved.workspaceId().equals(op.workspaceId())
                || !saved.callerId().equals(op.callerId()))
            throw new ConflictException("Operation identity was reused with another payload");
    }

    public Operation operation(UUID id, boolean lock) {
        return jdbc
                .query(
                        "SELECT * FROM canvas_operations WHERE id=?" + (lock ? " FOR UPDATE" : ""),
                        (r, i) ->
                                new Operation(
                                        id,
                                        r.getObject("workspace_id", UUID.class),
                                        r.getObject("document_id", UUID.class),
                                        r.getObject("caller_id", UUID.class),
                                        r.getObject("proposal_id", UUID.class),
                                        r.getString("kind"),
                                        r.getObject("source_operation_id", UUID.class),
                                        r.getObject("epoch", Long.class),
                                        r.getString("patch") == null
                                                ? null
                                                : json.readValue(
                                                        r.getString("patch"),
                                                        dev.researchhub.document.application
                                                                .CanvasEdit.Patch.class),
                                        r.getString("receipt") == null
                                                ? null
                                                : json.readValue(
                                                        r.getString("receipt"), Receipt.class)),
                        id)
                .stream()
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Canvas operation was not found"));
    }

    public void patch(UUID id, dev.researchhub.document.application.CanvasEdit.Patch patch) {
        jdbc.update(
                "UPDATE canvas_operations SET patch=?::jsonb WHERE id=?",
                json.writeValueAsString(patch),
                id);
    }

    public void receipt(UUID id, Receipt receipt) {
        jdbc.update(
                "UPDATE canvas_operations SET receipt=?::jsonb WHERE id=?",
                json.writeValueAsString(receipt),
                id);
    }
}
