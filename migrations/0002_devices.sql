-- Device (UDID) collection via Apple's Profile Service. Forward-only migration.
CREATE TABLE device_requests (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_device_requests_project ON device_requests(project_id, created_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_id TEXT REFERENCES device_requests(id) ON DELETE SET NULL,
  udid TEXT NOT NULL,
  product TEXT,
  os_version TEXT,
  device_name TEXT,
  label TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, udid)
);
CREATE INDEX idx_devices_project ON devices(project_id, created_at);
