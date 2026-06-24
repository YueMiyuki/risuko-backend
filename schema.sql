-- D1 schema for risuko settings sync

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  github_id INTEGER UNIQUE,
  github_username TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  magic_token TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_magic_link_magic_token ON magic_link_tokens(magic_token);

CREATE INDEX IF NOT EXISTS idx_magic_link_email_code_used_expires
  ON magic_link_tokens(email, code, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_magic_link_used
  ON magic_link_tokens(used);

CREATE INDEX IF NOT EXISTS idx_magic_link_expires_at
  ON magic_link_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
