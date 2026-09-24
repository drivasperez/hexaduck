-- Adds a game column so the leaderboard can serve more than one game. SQLite can't change a
-- primary key in place, so both tables are rebuilt; existing rows all belong to Hexaduck.
CREATE TABLE runs_new (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  mode INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
INSERT INTO runs_new (id, game, mode, started_at, used) SELECT id, 'hexaduck', mode, started_at, used FROM runs;
DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;
CREATE INDEX runs_started_at ON runs (started_at);

-- `score` is in the game's stored unit (see src/games.ts); higher is better for every game.
CREATE TABLE scores_new (
  game TEXT NOT NULL,
  mode INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game, mode, name)
);
INSERT INTO scores_new (game, mode, name, score, created_at) SELECT 'hexaduck', mode, name, time_ms, created_at FROM scores;
DROP TABLE scores;
ALTER TABLE scores_new RENAME TO scores;
CREATE INDEX scores_board ON scores (game, mode, score DESC);
