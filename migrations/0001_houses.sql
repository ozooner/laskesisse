-- One row = one household expecting visitors on one specific evening.
CREATE TABLE houses (
  id              TEXT PRIMARY KEY,
  event           TEXT NOT NULL CHECK (event IN ('mardi', 'kadri')),
  event_date      TEXT NOT NULL,              -- YYYY-MM-DD, Europe/Tallinn
  address         TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  time_from       TEXT NOT NULL,              -- HH:MM
  time_to         TEXT NOT NULL,
  rules           TEXT NOT NULL DEFAULT '[]', -- JSON array of rule keys
  note            TEXT NOT NULL DEFAULT '',
  edit_token_hash TEXT NOT NULL,              -- SHA-256 of the private edit token
  reports         INTEGER NOT NULL DEFAULT 0,
  hidden          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

CREATE INDEX houses_event_date ON houses (event, event_date);
