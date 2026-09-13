-- 002_lobby_events.sql
-- Monotonically increasing event log for serverless-safe realtime sync and cursor replay

CREATE TABLE IF NOT EXISTS lobby_events (
    id BIGSERIAL PRIMARY KEY,
    lobby_code TEXT NOT NULL,
    game_id UUID,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    target_id TEXT, -- NULL (all), 'host' (host only), or specific player_id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lobby_events_code_id ON lobby_events(lobby_code, id);
CREATE INDEX IF NOT EXISTS idx_lobby_events_created ON lobby_events(created_at);
