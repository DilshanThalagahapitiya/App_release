-- Interactive Simulator Preview (Appetize.io)
-- A simulator build is an ordinary row in `builds` (history preserved); build_kind tells it apart from an IPA.
ALTER TABLE builds ADD COLUMN build_kind TEXT NOT NULL DEFAULT 'ipa' CHECK (build_kind IN ('ipa','simulator'));

-- Preview links reuse the existing link machinery (password, expiry, revocation, named users).
ALTER TABLE distribution_links ADD COLUMN kind TEXT NOT NULL DEFAULT 'install' CHECK (kind IN ('install','preview'));

CREATE TABLE simulator_previews (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id TEXT NOT NULL UNIQUE REFERENCES builds(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','processing','ready','failed','deleted')),
  status_detail TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  file_type TEXT NOT NULL DEFAULT 'zip' CHECK (file_type IN ('zip','tar.gz')),
  mode TEXT NOT NULL DEFAULT 'create' CHECK (mode IN ('create','update')),
  appetize_public_key TEXT,
  appetize_version_code INTEGER,
  appetize_disabled INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  device TEXT NOT NULL DEFAULT 'iphone15pro',
  os_version TEXT,
  expires_at TEXT,
  uploaded_at TEXT,
  ready_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sim_previews_project ON simulator_previews(project_id, created_at);
CREATE INDEX idx_sim_previews_work ON simulator_previews(status, next_attempt_at);
