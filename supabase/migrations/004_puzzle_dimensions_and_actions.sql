-- 004_puzzle_dimensions_and_actions.sql
-- Persist puzzle dimensions per lobby/game and dedupe client actions across serverless instances.

ALTER TABLE lobbies
ADD COLUMN IF NOT EXISTS grid_cols INTEGER NOT NULL DEFAULT 3 CHECK (grid_cols >= 1),
ADD COLUMN IF NOT EXISTS grid_rows INTEGER NOT NULL DEFAULT 3 CHECK (grid_rows >= 1),
ADD COLUMN IF NOT EXISTS piece_count INTEGER NOT NULL DEFAULT 9 CHECK (piece_count >= 1);

ALTER TABLE games
ADD COLUMN IF NOT EXISTS grid_cols INTEGER NOT NULL DEFAULT 3 CHECK (grid_cols >= 1),
ADD COLUMN IF NOT EXISTS grid_rows INTEGER NOT NULL DEFAULT 3 CHECK (grid_rows >= 1),
ADD COLUMN IF NOT EXISTS piece_count INTEGER NOT NULL DEFAULT 9 CHECK (piece_count >= 1);

UPDATE lobbies
SET piece_count = grid_cols * grid_rows
WHERE piece_count IS NULL OR piece_count <> grid_cols * grid_rows;

UPDATE games
SET piece_count = grid_cols * grid_rows
WHERE piece_count IS NULL OR piece_count <> grid_cols * grid_rows;

CREATE TABLE IF NOT EXISTS client_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lobby_code TEXT NOT NULL,
    game_id UUID REFERENCES games(id) ON DELETE SET NULL,
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    action_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('SWAP', 'COMPLETE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_actions_unique
ON client_actions (
    lobby_code,
    player_id,
    COALESCE(game_id, '00000000-0000-0000-0000-000000000000'::uuid),
    action_id
);

CREATE INDEX IF NOT EXISTS idx_client_actions_lobby_created
ON client_actions(lobby_code, created_at DESC);
