-- 003_player_active_lifecycle.sql
-- Supports clean session lifecycle: deactivates players on lobby reset while preserving historical audit/game_players records

ALTER TABLE players ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE players DROP CONSTRAINT IF EXISTS uq_players_lobby_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_players_lobby_slot_active ON players (lobby_id, slot) WHERE active = TRUE;

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
    SELECT * INTO v_lobby FROM lobbies WHERE code = p_code FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND', 'message', 'Lobby not found.');
    END IF;

    IF v_lobby.status IN ('MEMORY', 'PUZZLE') THEN
        RETURN jsonb_build_object('error', 'ALREADY_STARTED', 'message', 'Game has already started. Wait for the next round.');
    END IF;

    SELECT COUNT(*) INTO v_player_count FROM players WHERE lobby_id = v_lobby.id AND active = TRUE;
    IF v_player_count >= v_lobby.max_players THEN
        RETURN jsonb_build_object('error', 'FULL', 'message', 'Lobby is full (5/5). Please wait for the next game.');
    END IF;

    IF EXISTS (SELECT 1 FROM players WHERE lobby_id = v_lobby.id AND active = TRUE AND LOWER(TRIM(name)) = LOWER(TRIM(p_name))) THEN
        RETURN jsonb_build_object('error', 'CONFLICT', 'message', 'That name is already taken in this game.');
    END IF;

    SELECT ARRAY_AGG(slot) INTO v_used_slots FROM players WHERE lobby_id = v_lobby.id AND active = TRUE;
    v_slot := 1;
    FOR v_i IN 1..v_lobby.max_players LOOP
        IF v_used_slots IS NULL OR NOT (v_i = ANY(v_used_slots)) THEN
            v_slot := v_i;
            EXIT;
        END IF;
    END LOOP;

    INSERT INTO players (id, lobby_id, name, player_token_hash, connected, score, slot, active, joined_at, last_seen_at)
    VALUES (p_player_id, v_lobby.id, TRIM(p_name), p_token_hash, TRUE, 0, v_slot, TRUE, NOW(), NOW());

    RETURN jsonb_build_object(
        'success', TRUE,
        'lobby_id', v_lobby.id,
        'slot', v_slot
    );
END;
$$ LANGUAGE plpgsql;
