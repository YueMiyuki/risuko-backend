CREATE TABLE IF NOT EXISTS share_sessions (
  id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL,
  ticket TEXT,
  file_meta TEXT,
  user_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_share_sessions_device_code
  ON share_sessions(device_code);

CREATE INDEX IF NOT EXISTS idx_share_sessions_expires_at
  ON share_sessions(expires_at);
