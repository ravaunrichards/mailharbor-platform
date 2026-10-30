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
    event_payload := json_build_object(
      'ownerId', OLD.owner_id,
      'messageId', OLD.id,
      'operation', 'deleted'
    );
    PERFORM pg_notify('mailharbor_mail_events', event_payload::text);
    RETURN OLD;
  END IF;

  event_payload := json_build_object(
    'ownerId', NEW.owner_id,
    'messageId', NEW.id,
    'operation', lower(TG_OP)
  );
  PERFORM pg_notify('mailharbor_mail_events', event_payload::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mail_messages_realtime_notify ON mail_messages;
CREATE TRIGGER mail_messages_realtime_notify
AFTER INSERT OR UPDATE OR DELETE ON mail_messages
FOR EACH ROW EXECUTE FUNCTION mailharbor_notify_message_change();
