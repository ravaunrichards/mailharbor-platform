-- Canonical schema mirror for manual inspection or restore workflows.
-- Runtime deployments apply numbered files from database/migrations through backend/src/migrate.js.
CREATE TABLE IF NOT EXISTS mail_users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_email_verifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES mail_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_email_verifications_expiry_idx
  ON mail_email_verifications(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS mail_messages (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES mail_users(id) ON DELETE CASCADE,
  sender_email VARCHAR(254) NOT NULL,
  reply_to VARCHAR(254),
  recipients JSONB NOT NULL DEFAULT '{"to":[],"cc":[],"bcc":[]}'::jsonb,
  subject VARCHAR(998) NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  folder VARCHAR(20) NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox','sent','drafts','spam','trash','archive')),
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'received'
    CHECK (delivery_status IN ('received','queued','sent','failed')),
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_messages_owner_folder_idx
  ON mail_messages(owner_id, folder, created_at DESC);
CREATE INDEX IF NOT EXISTS mail_messages_owner_unread_idx
  ON mail_messages(owner_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS mail_messages_owner_starred_idx
  ON mail_messages(owner_id, created_at DESC) WHERE is_starred = true;
CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_provider_message_idx
  ON mail_messages(owner_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mail_outbox (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT REFERENCES mail_users(id) ON DELETE SET NULL,
  message_id BIGINT REFERENCES mail_messages(id) ON DELETE SET NULL,
  sender_email VARCHAR(254) NOT NULL,
  reply_to VARCHAR(254),
  recipients JSONB NOT NULL,
  subject VARCHAR(998) NOT NULL DEFAULT '',
  body_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_outbox_pending_idx
  ON mail_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('queued','processing');

CREATE TABLE IF NOT EXISTS mail_inbound_events (
  event_id VARCHAR(500) PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_users_email_verified_idx
  ON mail_users(email) WHERE email_verified_at IS NOT NULL;


-- Realtime mailbox delivery service and single-use socket tickets.
CREATE TABLE IF NOT EXISTS mail_realtime_tickets (
  token_hash CHAR(64) PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES mail_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_realtime_tickets_expiry_idx
  ON mail_realtime_tickets(expires_at);

CREATE OR REPLACE FUNCTION mailharbor_notify_message_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_payload JSON;
BEGIN
  IF TG_OP = 'DELETE' THEN
    event_payload := json_build_object('ownerId', OLD.owner_id, 'messageId', OLD.id, 'operation', 'deleted');
    PERFORM pg_notify('mailharbor_mail_events', event_payload::text);
    RETURN OLD;
  END IF;
  event_payload := json_build_object('ownerId', NEW.owner_id, 'messageId', NEW.id, 'operation', lower(TG_OP));
  PERFORM pg_notify('mailharbor_mail_events', event_payload::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mail_messages_realtime_notify ON mail_messages;
CREATE TRIGGER mail_messages_realtime_notify
AFTER INSERT OR UPDATE OR DELETE ON mail_messages
FOR EACH ROW EXECUTE FUNCTION mailharbor_notify_message_change();
