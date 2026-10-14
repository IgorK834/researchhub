package dev.researchhub.user.infrastructure;

import java.util.*;

/** Explicit erasure inventory. The schema test fails when a new table has no classification. */
public final class PersonalDataInventory {
    private PersonalDataInventory() {}
    public static final Set<String> TABLES=Set.of(
        "users","workspaces","workspace_members","documents","document_versions","sources","source_versions","processing_jobs",
        "source_extractions","source_extraction_runs","source_retrieval_sets","source_retrieval_chunks","retrieval_embedding_models","source_chunk_embeddings",
        "ai_generation_runs","ai_conversations","ai_messages","ai_authoring_suggestions","ai_authoring_events","ai_source_analyses",
        "processing_job_source_versions","source_version_extractions","source_version_retrieval_sets","ai_source_analysis_sources",
        "analyses","analysis_inputs","analysis_plan_attempts","analysis_executions","analysis_execution_artifacts","analysis_execution_records","analysis_origins",
        "collaboration_documents","collaboration_credentials","document_comments","comment_replies","comment_audit_events","product_audit_events",
        "comment_ai_suggestions","comment_ai_citation_acceptances","document_content_operations","ai_usage_events","ai_rag_traces","report_exports",
        "external_source_searches","external_source_references","spring_session","spring_session_attributes","cost_quota_bucket","registration_rejections",
        "canvas_contexts","canvas_turns","canvas_proposals","canvas_operations","analysis_problems","problem_executions","problem_artifacts",
        "workspace_invitation","account_lifecycle_token","account_audit_events","security_operation_bucket","account_erasure_jobs","account_erasure_objects",
        "erased_source_versions","erased_review_audit_events","bibliography_imports","bibliography_items",
        "bibliography_import_records","workspace_search_entries","document_template_creations",
        "notifications","notification_outbox","notification_preferences","review_tasks");
    /** Research payloads cannot be removed from somebody else's workspace without an explicit scope decision. */
    public static final Map<String,String> CONTRIBUTIONS=Map.ofEntries(
        Map.entry("document_template_creations","created_by"),Map.entry("review_tasks","created_by"),
        Map.entry("bibliography_items","created_by"),Map.entry("bibliography_imports","created_by"),
        Map.entry("sources","uploaded_by"),Map.entry("source_versions","uploaded_by"),Map.entry("documents","created_by"),Map.entry("document_content_operations","actor_user_id"),
        Map.entry("ai_generation_runs","caller_id"),Map.entry("ai_conversations","created_by"),Map.entry("ai_messages","author_id"),
        Map.entry("ai_authoring_suggestions","created_by"),Map.entry("ai_authoring_events","accepted_by"),Map.entry("ai_source_analyses","created_by"),
        Map.entry("analyses","created_by"),Map.entry("analysis_executions","requested_by"),Map.entry("analysis_problems","created_by"),
        Map.entry("problem_executions","requested_by"),Map.entry("document_comments","author_id"),Map.entry("comment_replies","author_id"),
        Map.entry("comment_ai_suggestions","requested_by"),Map.entry("report_exports","requested_by"),Map.entry("canvas_contexts","created_by"),
        Map.entry("canvas_turns","caller_id"),Map.entry("canvas_operations","caller_id"),Map.entry("external_source_searches","searched_by"),Map.entry("external_source_references","recorded_by"));
}
