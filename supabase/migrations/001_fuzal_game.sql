-- FUZAL Game Migration
-- Schema for Lobbies, Players, Puzzle Images, Games, and Game Players

-- 1. Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Lobbies Table
CREATE TABLE IF NOT EXISTS lobbies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    host_token_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('LOBBY', 'MEMORY', 'PUZZLE', 'FINISHED')),
    max_players INTEGER NOT NULL DEFAULT 5,
    current_game_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lobbies_code ON lobbies(code);

DROP TRIGGER IF EXISTS trg_lobbies_updated_at ON lobbies;
CREATE TRIGGER trg_lobbies_updated_at
BEFORE UPDATE ON lobbies
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 3. Players Table
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    player_token_hash TEXT NOT NULL,
    connected BOOLEAN NOT NULL DEFAULT TRUE,
    score INTEGER NOT NULL DEFAULT 0,
    slot INTEGER NOT NULL CHECK (slot >= 1 AND slot <= 5),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_players_lobby_slot UNIQUE (lobby_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_players_lobby_id ON players(lobby_id);

-- 4. Puzzle Images Table
CREATE TABLE IF NOT EXISTS puzzle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/webp',
    width INTEGER NOT NULL DEFAULT 800,
    height INTEGER NOT NULL DEFAULT 800,
    grid_rows INTEGER NOT NULL DEFAULT 4,
    grid_columns INTEGER NOT NULL DEFAULT 4,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puzzle_images_active ON puzzle_images(active);

-- 5. Games Table
CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lobby_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES puzzle_images(id),
    state TEXT NOT NULL CHECK (state IN ('MEMORY', 'PUZZLE', 'FINISHED')),
    memory_started_at TIMESTAMPTZ,
    memory_ends_at TIMESTAMPTZ,
    puzzle_started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    winner_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_lobby_id ON games(lobby_id);

-- Add foreign key from lobbies.current_game_id to games(id)
ALTER TABLE lobbies 
DROP CONSTRAINT IF EXISTS fk_lobbies_current_game;

ALTER TABLE lobbies
ADD CONSTRAINT fk_lobbies_current_game
FOREIGN KEY (current_game_id) REFERENCES games(id) ON DELETE SET NULL;

-- 6. Game Players Table
CREATE TABLE IF NOT EXISTS game_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    board JSONB NOT NULL,
    moves INTEGER NOT NULL DEFAULT 0,
    correct_slots INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_game_players_game_player UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_player_id ON game_players(player_id);

-- 7. Atomic Join Function
CREATE OR REPLACE FUNCTION join_lobby_atomic(
    p_code TEXT,
    p_player_id UUID,
    p_name TEXT,
    p_token_hash TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_lobby RECORD;
    v_player_count INTEGER;
    v_slot INTEGER;
    v_used_slots INTEGER[];
    v_i INTEGER;
BEGIN
    -- Lock the lobby row
    SELECT * INTO v_lobby FROM lobbies WHERE code = p_code FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND', 'message', 'Lobby not found.');
    END IF;

    IF v_lobby.status IN ('MEMORY', 'PUZZLE') THEN
        RETURN jsonb_build_object('error', 'ALREADY_STARTED', 'message', 'Game has already started. Wait for the next round.');
    END IF;

    SELECT COUNT(*) INTO v_player_count FROM players WHERE lobby_id = v_lobby.id;
    IF v_player_count >= v_lobby.max_players THEN
        RETURN jsonb_build_object('error', 'FULL', 'message', 'Lobby is full (5/5). Please wait for the next game.');
    END IF;

    IF EXISTS (SELECT 1 FROM players WHERE lobby_id = v_lobby.id AND LOWER(TRIM(name)) = LOWER(TRIM(p_name))) THEN
        RETURN jsonb_build_object('error', 'CONFLICT', 'message', 'That name is already taken in this game.');
    END IF;

    -- Find first free slot between 1 and 5
    SELECT ARRAY_AGG(slot) INTO v_used_slots FROM players WHERE lobby_id = v_lobby.id;
    v_slot := 1;
    FOR v_i IN 1..v_lobby.max_players LOOP
        IF v_used_slots IS NULL OR NOT (v_i = ANY(v_used_slots)) THEN
            v_slot := v_i;
            EXIT;
        END IF;
    END LOOP;

    INSERT INTO players (id, lobby_id, name, player_token_hash, connected, score, slot, joined_at, last_seen_at)
    VALUES (p_player_id, v_lobby.id, TRIM(p_name), p_token_hash, TRUE, 0, v_slot, NOW(), NOW());

    RETURN jsonb_build_object(
        'success', TRUE,
        'lobby_id', v_lobby.id,
        'slot', v_slot
    );
END;
$$ LANGUAGE plpgsql;

-- 8. Atomic Winner Claim Function
CREATE OR REPLACE FUNCTION claim_game_winner(
    p_game_id UUID,
    p_player_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    UPDATE games
    SET
        state = 'FINISHED',
        winner_player_id = p_player_id,
        finished_at = NOW()
    WHERE
        id = p_game_id
        AND state = 'PUZZLE'
        AND winner_player_id IS NULL;
    
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    
    IF v_affected = 1 THEN
        UPDATE players
        SET score = score + 1
        WHERE id = p_player_id;
        
        -- Also update lobby status to FINISHED
        UPDATE lobbies
        SET status = 'FINISHED'
        WHERE current_game_id = p_game_id;

        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. Storage Bucket Creation (Idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'puzzle-images',
    'puzzle-images',
    TRUE,
    10485760, -- 10MB
    ARRAY['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
    public = TRUE,
    allowed_mime_types = ARRAY['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml'];
