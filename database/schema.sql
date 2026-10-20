CREATE TABLE IF NOT EXISTS mail_users (
 id BIGSERIAL PRIMARY KEY,
 email VARCHAR(254) NOT NULL UNIQUE,
 display_name VARCHAR(120) NOT NULL DEFAULT '',
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mail_messages (
 id BIGSERIAL PRIMARY KEY,
 owner_id BIGINT NOT NULL REFERENCES mail_users(id) ON DELETE CASCADE,
 sender VARCHAR(254) NOT NULL,
 recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
 subject VARCHAR(998) NOT NULL DEFAULT '',
 body_text TEXT NOT NULL DEFAULT '',
 folder VARCHAR(20) NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox','sent','drafts','spam','trash','archive')),
 is_read BOOLEAN NOT NULL DEFAULT false,
 is_starred BOOLEAN NOT NULL DEFAULT false,
 sent_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_messages_owner_folder_idx ON mail_messages(owner_id, folder, created_at DESC);
CREATE INDEX IF NOT EXISTS mail_messages_owner_unread_idx ON mail_messages(owner_id, is_read) WHERE is_read = false;
CREATE TABLE IF NOT EXISTS mail_labels (
 id BIGSERIAL PRIMARY KEY,
 owner_id BIGINT NOT NULL REFERENCES mail_users(id) ON DELETE CASCADE,
 name VARCHAR(60) NOT NULL,
 color VARCHAR(20) NOT NULL DEFAULT 'blue',
 UNIQUE(owner_id,name)
);
CREATE TABLE IF NOT EXISTS mail_message_labels (
 message_id BIGINT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
 label_id BIGINT NOT NULL REFERENCES mail_labels(id) ON DELETE CASCADE,
 PRIMARY KEY(message_id,label_id)
);
CREATE TABLE IF NOT EXISTS mail_attachments (
 id BIGSERIAL PRIMARY KEY,
 message_id BIGINT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
 filename VARCHAR(255) NOT NULL,
 mime_type VARCHAR(127) NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes >= 0),
 storage_key TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
