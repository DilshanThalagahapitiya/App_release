-- Live install progress shown to the person installing a build (stage + bytes served), keyed by link and a hashed client address.
CREATE TABLE install_progress (
  link_id TEXT NOT NULL REFERENCES distribution_links(id) ON DELETE CASCADE,
  client_hash TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('manifest','downloading','downloaded')),
  bytes INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (link_id, client_hash)
);
CREATE INDEX idx_install_progress_updated ON install_progress(link_id, updated_at);
