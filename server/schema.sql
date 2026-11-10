CREATE TABLE IF NOT EXISTS sessions (
 id uuid PRIMARY KEY, code text UNIQUE NOT NULL, title text NOT NULL,
 phase integer NOT NULL DEFAULT -1, revision integer NOT NULL DEFAULT 0,
 closed boolean NOT NULL DEFAULT false, gallery_paused boolean NOT NULL DEFAULT false,
 stage_view text NOT NULL DEFAULT 'overview', ends_at timestamptz, remaining_ms bigint,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS participants (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
 join_hash text NOT NULL UNIQUE, data jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 0,
 consent_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS participant_session ON participants(session_id);
CREATE TABLE IF NOT EXISTS credentials (
 hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
 participant_id uuid REFERENCES participants ON DELETE CASCADE, role text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
 owner text NOT NULL, operation_id uuid NOT NULL, digest text NOT NULL,
 result jsonb NOT NULL, PRIMARY KEY(owner, operation_id)
);
CREATE TABLE IF NOT EXISTS assets (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
 participant_id uuid NOT NULL REFERENCES participants ON DELETE CASCADE,
 consent_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS submissions (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE,
 participant_id uuid NOT NULL REFERENCES participants ON DELETE CASCADE,
 kind text NOT NULL, title text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
 mine text NOT NULL DEFAULT '', asset_id uuid REFERENCES assets ON DELETE SET NULL,
 hidden boolean NOT NULL DEFAULT false, consent_version integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(participant_id,kind)
);
CREATE INDEX IF NOT EXISTS submission_session ON submissions(session_id);
-- Additive activity reporting; survey revisions and existing workshop data are preserved.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS current_step integer;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS step_started_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS telemetry_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS pending_since_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS client_status jsonb NOT NULL DEFAULT '{}';
-- Runs isolate a reset from previous credentials, writes, and recovery data.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS run integer NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS run integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS participant_session_run ON participants(session_id,run);
-- Keep existing runs on their original flow and make public consent independent of room sharing.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS flow_version integer NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS first_revealed boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS exchange boolean NOT NULL DEFAULT false;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS writeup_version integer NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'room';
ALTER TABLE participants ADD COLUMN IF NOT EXISTS retain_until timestamptz;
CREATE INDEX IF NOT EXISTS participant_retention ON participants(retain_until) WHERE retain_until IS NOT NULL;
CREATE TABLE IF NOT EXISTS expired_photo_files (asset_id uuid PRIMARY KEY);
