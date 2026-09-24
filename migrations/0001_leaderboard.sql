-- One row per game started. A run id is handed out when a game begins and can be
-- redeemed for a score exactly once, which lets the server check that the claimed
-- survival time is no longer than the wall-clock time since the run started.
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  mode INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX runs_started_at ON runs (started_at);

-- Best time per (scope, name). Names are matched case-insensitively.
CREATE TABLE scores (
  mode INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  time_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mode, name)
);
CREATE INDEX scores_mode_time ON scores (mode, time_ms DESC);
