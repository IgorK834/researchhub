-- One transactionally maintained, workspace-scoped lexical projection. PostgreSQL remains the only engine.
CREATE FUNCTION research_search_json_text(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE part record; fragment text; result text := ''; BEGIN
    IF jsonb_typeof(value)='array' THEN
        FOR part IN SELECT v FROM jsonb_array_elements(value) v LOOP
            result := concat_ws(' ',result,research_search_json_text(part.v));
        END LOOP;
    ELSIF jsonb_typeof(value)='object' THEN
        FOR part IN SELECT key,val FROM jsonb_each(value) AS fields(key,val)
                    WHERE key NOT IN ('code','diagnostics','provenance','attrs','model','usage','rows','repairHints') LOOP
            IF jsonb_typeof(part.val) IN ('array','object') THEN
                fragment := research_search_json_text(part.val);
            ELSIF part.key IN ('text','title','answer','content','summary','name','description',
                               'authors','author','venue','doi','DOI','family','given','literal') THEN
                fragment := part.val #>> '{}';
            ELSE fragment := ''; END IF;
            result := concat_ws(' ',result,fragment);
        END LOOP;
    ELSIF jsonb_typeof(value)='string' THEN result := value #>> '{}';
    END IF;
    RETURN btrim(result);
END $$;

CREATE TABLE workspace_search_entries (
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    type varchar(16) NOT NULL CHECK(type IN ('DOCUMENT','SOURCE','CONVERSATION','COMMENT','ANALYSIS')),
    object_id uuid NOT NULL,
    title varchar(1000) NOT NULL,
    content text NOT NULL,
    location varchar(2048) NOT NULL,
    source_version varchar(128),
    updated_at timestamptz NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig,coalesce(title,'') || ' ' || coalesce(content,''))
    ) STORED,
    PRIMARY KEY(workspace_id,type,object_id)
);
CREATE INDEX ix_workspace_search_scope_order
    ON workspace_search_entries(workspace_id,archived,updated_at DESC,type,object_id DESC);
CREATE INDEX ix_workspace_search_vector ON workspace_search_entries USING gin(search_vector);

CREATE FUNCTION refresh_document_search(target_workspace uuid,target_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,source_version,updated_at,archived)
    SELECT d.workspace_id,'DOCUMENT',d.id,d.title,research_search_json_text(d.content),
           '/app/workspaces/'||d.workspace_id||'/documents/'||d.id,d.revision::text,d.updated_at,d.archived_at IS NOT NULL
    FROM documents d WHERE d.workspace_id=target_workspace AND d.id=target_id
    ON CONFLICT(workspace_id,type,object_id) DO UPDATE SET title=excluded.title,content=excluded.content,
        location=excluded.location,source_version=excluded.source_version,updated_at=excluded.updated_at,archived=excluded.archived;
    UPDATE workspace_search_entries e SET archived=d.archived_at IS NOT NULL,source_version=d.revision::text,
        title=left(d.title||' · comment',1000),updated_at=greatest(e.updated_at,d.updated_at)
    FROM documents d WHERE e.workspace_id=target_workspace AND e.type='COMMENT'
      AND d.workspace_id=e.workspace_id AND d.id=target_id AND e.location LIKE '%/documents/'||target_id||'%';
END;
$$;
CREATE FUNCTION document_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_document_search(NEW.workspace_id,NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER tg_document_search AFTER INSERT OR UPDATE OF title,content,revision,updated_at,archived_at ON documents
    FOR EACH ROW EXECUTE FUNCTION document_search_trigger();

CREATE FUNCTION refresh_source_search(target_workspace uuid,target_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,source_version,updated_at,archived)
    SELECT s.workspace_id,'SOURCE',s.id,coalesce(s.bibliography->>'title',s.display_name),
           concat_ws(' ',s.display_name,s.original_filename,research_search_json_text(s.bibliography),
                     research_search_json_text(x.payload)),
           '/app/workspaces/'||s.workspace_id||'/sources/'||s.id||'?version='||s.active_version_id,
           s.active_version_id::text,s.updated_at,false
    FROM sources s LEFT JOIN source_version_extractions x
      ON x.workspace_id=s.workspace_id AND x.source_id=s.id AND x.source_version_id=s.active_version_id
    WHERE s.workspace_id=target_workspace AND s.id=target_id
    ON CONFLICT(workspace_id,type,object_id) DO UPDATE SET title=excluded.title,content=excluded.content,
        location=excluded.location,source_version=excluded.source_version,updated_at=excluded.updated_at,archived=false;
END;
$$;
CREATE FUNCTION source_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_source_search(NEW.workspace_id,NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER tg_source_search AFTER INSERT OR UPDATE OF display_name,bibliography,active_version_id,updated_at ON sources
    FOR EACH ROW EXECUTE FUNCTION source_search_trigger();
CREATE FUNCTION extraction_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_source_search(NEW.workspace_id,NEW.source_id); RETURN NEW;
END $$;
CREATE TRIGGER tg_extraction_search AFTER INSERT OR UPDATE OF payload ON source_extractions
    FOR EACH ROW EXECUTE FUNCTION extraction_search_trigger();
CREATE TRIGGER tg_version_extraction_search AFTER INSERT OR UPDATE OF payload ON source_version_extractions
    FOR EACH ROW EXECUTE FUNCTION extraction_search_trigger();

CREATE FUNCTION refresh_conversation_search(target_workspace uuid,target_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,source_version,updated_at,archived)
    SELECT c.workspace_id,'CONVERSATION',c.id,c.title,
           coalesce((SELECT string_agg(m.content,' ' ORDER BY m.sequence) FROM ai_messages m
                     WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id AND m.status='COMPLETED'),''),
           '/app/workspaces/'||c.workspace_id||'/ask?conversation='||c.id,(c.next_sequence-1)::text,c.updated_at,false
    FROM ai_conversations c WHERE c.workspace_id=target_workspace AND c.id=target_id
    ON CONFLICT(workspace_id,type,object_id) DO UPDATE SET title=excluded.title,content=excluded.content,
        location=excluded.location,source_version=excluded.source_version,updated_at=excluded.updated_at,archived=false;
END;
$$;
CREATE FUNCTION conversation_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_conversation_search(NEW.workspace_id,NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER tg_conversation_search AFTER INSERT OR UPDATE OF title,updated_at ON ai_conversations
    FOR EACH ROW EXECUTE FUNCTION conversation_search_trigger();
CREATE FUNCTION message_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_conversation_search(NEW.workspace_id,NEW.conversation_id); RETURN NEW;
END $$;
CREATE TRIGGER tg_message_search AFTER INSERT OR UPDATE OF content,status ON ai_messages
    FOR EACH ROW EXECUTE FUNCTION message_search_trigger();

CREATE FUNCTION refresh_comment_search(target_workspace uuid,target_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,source_version,updated_at,archived)
    SELECT c.workspace_id,'COMMENT',c.id,left(d.title||' · comment by '||c.author_name,1000),
           concat_ws(' ',c.body,c.anchor_quote,(SELECT string_agg(r.body,' ' ORDER BY r.created_at,r.id)
                                                FROM comment_replies r WHERE r.workspace_id=c.workspace_id AND r.comment_id=c.id)),
           '/app/workspaces/'||c.workspace_id||'/documents/'||c.document_id||'#comment-'||c.id,
           d.revision::text,c.updated_at,d.archived_at IS NOT NULL
    FROM document_comments c JOIN documents d ON d.workspace_id=c.workspace_id AND d.id=c.document_id
    WHERE c.workspace_id=target_workspace AND c.id=target_id
    ON CONFLICT(workspace_id,type,object_id) DO UPDATE SET title=excluded.title,content=excluded.content,
        location=excluded.location,source_version=excluded.source_version,updated_at=excluded.updated_at,archived=excluded.archived;
END;
$$;
CREATE FUNCTION comment_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_comment_search(NEW.workspace_id,NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER tg_comment_search AFTER INSERT OR UPDATE OF body,status,anchor_quote,updated_at ON document_comments
    FOR EACH ROW EXECUTE FUNCTION comment_search_trigger();
CREATE FUNCTION reply_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_comment_search(NEW.workspace_id,NEW.comment_id); RETURN NEW;
END $$;
CREATE TRIGGER tg_reply_search AFTER INSERT OR UPDATE OF body ON comment_replies
    FOR EACH ROW EXECUTE FUNCTION reply_search_trigger();

CREATE FUNCTION refresh_analysis_search(target_workspace uuid,target_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO workspace_search_entries(workspace_id,type,object_id,title,content,location,source_version,updated_at,archived)
    SELECT a.workspace_id,'ANALYSIS',a.id,left(a.user_prompt,1000),
           concat_ws(' ',a.user_prompt,research_search_json_text(a.plan),
             (SELECT string_agg(research_search_json_text(e.payload),' ' ORDER BY e.created_at)
              FROM analysis_executions e WHERE e.workspace_id=a.workspace_id AND e.analysis_id=a.id),
             (SELECT string_agg(research_search_json_text(p.payload),' ' ORDER BY p.created_at)
              FROM problem_executions p WHERE p.workspace_id=a.workspace_id AND p.analysis_id=a.id)),
           '/app/workspaces/'||a.workspace_id||'/analyses/'||a.id||
             coalesce('?execution='||(SELECT id::text FROM analysis_executions WHERE workspace_id=a.workspace_id
               AND analysis_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1),''),
           coalesce((SELECT id::text FROM analysis_executions WHERE workspace_id=a.workspace_id AND analysis_id=a.id
               ORDER BY created_at DESC,id DESC LIMIT 1),(SELECT id::text FROM problem_executions
               WHERE workspace_id=a.workspace_id AND analysis_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1)),
           a.updated_at,false
    FROM analyses a WHERE a.workspace_id=target_workspace AND a.id=target_id
    ON CONFLICT(workspace_id,type,object_id) DO UPDATE SET title=excluded.title,content=excluded.content,
        location=excluded.location,source_version=excluded.source_version,updated_at=excluded.updated_at,archived=false;
END;
$$;
CREATE FUNCTION analysis_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_analysis_search(NEW.workspace_id,NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER tg_analysis_search AFTER INSERT OR UPDATE OF user_prompt,plan,status,updated_at ON analyses
    FOR EACH ROW EXECUTE FUNCTION analysis_search_trigger();
CREATE FUNCTION execution_search_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM refresh_analysis_search(NEW.workspace_id,NEW.analysis_id); RETURN NEW;
END $$;
CREATE TRIGGER tg_execution_search AFTER INSERT OR UPDATE OF payload,status ON analysis_executions
    FOR EACH ROW EXECUTE FUNCTION execution_search_trigger();
CREATE TRIGGER tg_problem_execution_search AFTER INSERT OR UPDATE OF payload,status ON problem_executions
    FOR EACH ROW EXECUTE FUNCTION execution_search_trigger();

-- Existing objects become searchable without waiting for a future edit.
SELECT refresh_document_search(workspace_id,id) FROM documents;
SELECT refresh_source_search(workspace_id,id) FROM sources;
SELECT refresh_conversation_search(workspace_id,id) FROM ai_conversations;
SELECT refresh_comment_search(workspace_id,id) FROM document_comments;
SELECT refresh_analysis_search(workspace_id,id) FROM analyses;

COMMENT ON TABLE workspace_search_entries IS
    'Server-authorized workspace lexical projection; snippets are plain text and no model call is involved.';

CREATE TRIGGER z_erasure_publication BEFORE INSERT OR UPDATE ON workspace_search_entries
    FOR EACH ROW EXECUTE FUNCTION reject_erased_workspace_publication();
GRANT SELECT,INSERT,UPDATE,DELETE ON workspace_search_entries TO researchhub_erasure;

-- Extend the existing terminal erasure authority without changing V47 or allowing runtime trigger bypass.
DO $$ DECLARE definition text; BEGIN
    SELECT pg_get_functiondef('public.finish_account_erasure(uuid)'::regprocedure) INTO definition;
    definition := replace(definition, 'SET CONSTRAINTS ALL DEFERRED;',
        'SET CONSTRAINTS ALL DEFERRED;
         DELETE FROM public.bibliography_import_records WHERE workspace_id=ANY(job.workspace_ids);
         DELETE FROM public.bibliography_items WHERE workspace_id=ANY(job.workspace_ids);
         DELETE FROM public.bibliography_imports WHERE workspace_id=ANY(job.workspace_ids);
         DELETE FROM public.workspace_search_entries WHERE workspace_id=ANY(job.workspace_ids);');
    EXECUTE format('GRANT researchhub_erasure TO %I',current_user);
    GRANT CREATE ON SCHEMA public TO researchhub_erasure;
    EXECUTE definition;
    REVOKE CREATE ON SCHEMA public FROM researchhub_erasure;
    EXECUTE format('REVOKE researchhub_erasure FROM %I',current_user);
END $$;
