CREATE TABLE IF NOT EXISTS match_series (
  series_id TEXT PRIMARY KEY,
  esport TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  scheduled_start TEXT NOT NULL,
  last_state TEXT NOT NULL,
  latest_payload_json TEXT NOT NULL,
  final_verified INTEGER NOT NULL DEFAULT 0,
  final_payload_json TEXT,
  final_verified_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_series_state_start
  ON match_series(last_state, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_match_series_final_verified
  ON match_series(final_verified, scheduled_start);

CREATE TABLE IF NOT EXISTS match_games (
  game_id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  game_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  winner_team_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(series_id) REFERENCES match_series(series_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_games_series_number
  ON match_games(series_id, game_number);

CREATE TABLE IF NOT EXISTS match_contexts (
  series_id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(series_id) REFERENCES match_series(series_id) ON DELETE CASCADE
);
