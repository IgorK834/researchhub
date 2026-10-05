-- Computed evidence is bound to exact executions in both the request audit and conversation scope.
ALTER TABLE ai_generation_runs ADD COLUMN analysis_evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(analysis_evidence)='array' AND jsonb_array_length(analysis_evidence)<=6 AND octet_length(analysis_evidence::text)<=131072);
ALTER TABLE ai_messages ADD COLUMN selected_analysis_outputs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(selected_analysis_outputs)='array' AND jsonb_array_length(selected_analysis_outputs)<=6 AND octet_length(selected_analysis_outputs::text)<=4096);
