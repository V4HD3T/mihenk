-- Migration 009: Password reset and email verification (v0.1.0)
-- Additive. Existing accounts are marked already-verified, because they were
-- created before verification existed and locking them out would be worse than
-- the risk it addresses.
-- Usage: npm run migrate

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Everyone who already has an account keeps it working.
UPDATE users SET email_verified_at = NOW() WHERE email_verified_at IS NULL;

-- One table for both flows: the difference is only the purpose and lifetime.
--
-- The token itself is NEVER stored - only its SHA-256 hash. A leaked database
-- would otherwise hand over working password-reset links for every pending
-- request, which is the whole point of these being short-lived secrets.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set when redeemed, so a token works exactly once. A used reset link that
  -- still worked would turn a forwarded email into an account takeover.
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expiry ON auth_tokens(expires_at);
