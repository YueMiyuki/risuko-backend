-- Migration: add magic_token column for click-to-login magic links
ALTER TABLE magic_link_tokens ADD COLUMN magic_token TEXT;
CREATE INDEX IF NOT EXISTS idx_magic_link_magic_token ON magic_link_tokens(magic_token);
