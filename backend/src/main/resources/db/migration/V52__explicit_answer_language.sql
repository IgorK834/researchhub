-- NULL preserves the prompt identity of legacy requests. Explicit choices are part of retry identity.
ALTER TABLE ai_messages ADD COLUMN answer_language varchar(2)
    CHECK (answer_language IS NULL OR answer_language IN ('en','pl'));
