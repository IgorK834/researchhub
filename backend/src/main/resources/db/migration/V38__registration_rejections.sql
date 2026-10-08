-- Anonymous rejections cannot belong to a workspace or identify an attempted account.
CREATE TABLE registration_rejections (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id varchar(64) NOT NULL CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
    mode varchar(16) NOT NULL CHECK (mode IN ('disabled', 'invite-only')),
    event_type varchar(32) NOT NULL DEFAULT 'REGISTRATION_REJECTED' CHECK (event_type = 'REGISTRATION_REJECTED'),
    created_at timestamptz NOT NULL DEFAULT now()
);
