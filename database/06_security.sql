-- ============================================================
-- Migration 06 — Security: MFA, lockout, audit log
-- ============================================================

-- ── MFA & lockout fields on app_user ─────────────────────────
ALTER TABLE core.app_user
  ADD COLUMN IF NOT EXISTS mfa_secret       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS mfa_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failed_attempts  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until     TIMESTAMP WITH TIME ZONE;

-- ── Audit log — every write operation ────────────────────────
CREATE TABLE IF NOT EXISTS core.audit_log (
  log_id        BIGSERIAL PRIMARY KEY,
  event_time    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  user_id       UUID REFERENCES core.app_user(user_id) ON DELETE SET NULL,
  username      VARCHAR(100),
  action        VARCHAR(30)  NOT NULL,  -- LOGIN, LOGOUT, CREATE, UPDATE, DELETE, MFA_ENABLE, MFA_DISABLE, LOCKOUT
  resource_type VARCHAR(50),            -- equipment, dispatch, work_order …
  resource_id   VARCHAR(100),
  ip_address    INET,
  user_agent    TEXT,
  payload       JSONB,                  -- sanitised input (no passwords)
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON core.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time    ON core.audit_log(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON core.audit_log(action);

-- ── Purge policy: auto-delete logs > 1 year ──────────────────
-- (run via pg_cron in production; for dev we just define the view)
CREATE OR REPLACE VIEW core.v_recent_audit AS
  SELECT * FROM core.audit_log
  WHERE event_time > NOW() - INTERVAL '90 days'
  ORDER BY event_time DESC;

-- ── MFA backup codes table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.mfa_backup_code (
  code_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES core.app_user(user_id) ON DELETE CASCADE,
  code_hash   VARCHAR(100) NOT NULL,  -- bcrypt hash of the backup code
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  used_at     TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_user ON core.mfa_backup_code(user_id);
