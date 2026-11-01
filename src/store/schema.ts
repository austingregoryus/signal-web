export const SCHEMA_VERSION = 6

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,           -- group id (base64) or contact author_id
  type          TEXT NOT NULL,              -- 'dm' | 'group'
  display_name  TEXT,                       -- resolved in a later milestone; may be null
  avatar_path   TEXT,                       -- resolved in a later milestone
  last_activity INTEGER NOT NULL DEFAULT 0, -- ms timestamp of newest message
  last_read_at  INTEGER NOT NULL DEFAULT 0, -- ms timestamp up to which the user has read
  expire_timer_ms INTEGER NOT NULL DEFAULT 0 -- disappearing-message timer (0 = off)
);

-- Maps a phone-number-keyed conversation to its canonical UUID. A contact can
-- be keyed by number (when /api/start couldn't resolve a UUID) AND by UUID
-- (when their inbound reply arrives via signal-cli, which always supplies
-- sourceUuid). Without this, the two become separate conversations that never
-- thread together. resolveAlias() folds the number into the uuid at read/write
-- time, and mergeInto() physically collapses the duplicate rows.
CREATE TABLE IF NOT EXISTS contact_aliases (
  number TEXT PRIMARY KEY,
  uuid   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_aliases_uuid ON contact_aliases(uuid);

CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT NOT NULL,
  author_id        TEXT NOT NULL,           -- uuid preferred, else number
  author_number    TEXT,
  timestamp        INTEGER NOT NULL,        -- Signal message timestamp (ms) — identity
  received_at      INTEGER NOT NULL,        -- when we stored it (ms)
  direction        TEXT NOT NULL,           -- 'in' | 'out'
  body             TEXT,
  quote_author_id  TEXT,
  quote_timestamp  INTEGER,
  edited_timestamp INTEGER,                 -- set when the message was edited
  deleted          INTEGER NOT NULL DEFAULT 0,  -- tombstone (remoteDelete)
  expires_at       INTEGER,                 -- disappearing message: delete at this ms time
  -- conversation_id is part of the identity: (author_id, timestamp) alone is
  -- attacker-controllable (a contact picks the send timestamp on the wire), so
  -- without conversation_id a group message and a DM crafted with the same
  -- timestamp would collide and one could silently overwrite the other's
  -- conversation/body. Scoping the key per conversation keeps them distinct.
  UNIQUE(author_id, timestamp, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS reactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target_author_id TEXT NOT NULL,
  target_timestamp INTEGER NOT NULL,
  reactor_id       TEXT NOT NULL,
  emoji            TEXT NOT NULL,
  timestamp        INTEGER NOT NULL,
  UNIQUE(target_author_id, target_timestamp, reactor_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target_author_id TEXT NOT NULL,
  target_timestamp INTEGER NOT NULL,
  recipient_id     TEXT NOT NULL,
  type             TEXT NOT NULL,           -- 'delivery' | 'read' | 'viewed'
  timestamp        INTEGER NOT NULL,
  UNIQUE(target_author_id, target_timestamp, recipient_id, type)
);

CREATE TABLE IF NOT EXISTS attachments (
  id                TEXT PRIMARY KEY,       -- opaque internal id
  message_author_id TEXT NOT NULL,
  message_timestamp INTEGER NOT NULL,
  content_type      TEXT,
  filename          TEXT,
  size              INTEGER,
  signal_id         TEXT,                   -- signal-cli attachment id (fetch later)
  stored_path       TEXT                    -- set when downloaded+encrypted (later milestone)
);
CREATE INDEX IF NOT EXISTS idx_attachments_message
  ON attachments(message_author_id, message_timestamp);

CREATE TABLE IF NOT EXISTS auth_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  level      TEXT NOT NULL DEFAULT 'full'
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id         TEXT PRIMARY KEY,   -- credential id (base64url)
  public_key BLOB NOT NULL,
  counter    INTEGER NOT NULL,
  transports TEXT,               -- JSON array of transport strings
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webauthn_challenge (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  challenge  TEXT,
  created_at INTEGER
);
`
