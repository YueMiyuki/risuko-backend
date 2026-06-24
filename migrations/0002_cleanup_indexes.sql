CREATE INDEX IF NOT EXISTS idx_magic_link_email_code_used_expires
  ON magic_link_tokens(email, code, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_magic_link_used
  ON magic_link_tokens(used);

CREATE INDEX IF NOT EXISTS idx_magic_link_expires_at
  ON magic_link_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);
