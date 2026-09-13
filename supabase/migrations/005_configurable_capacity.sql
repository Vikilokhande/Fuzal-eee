-- 005_configurable_capacity.sql
-- Expand player slot check constraint from 1..5 to 1..100 to support configurable event capacity.
-- Update join_lobby_atomic to support dynamic max_players message and slot assignment.

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_slot_check;
ALTER TABLE players ADD CONSTRAINT players_slot_check CHECK (slot >= 1 AND slot <= 100);

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
    v_max INTEGER;
BEGIN
    SELECT * INTO v_lobby FROM lobbies WHERE code = p_code FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'NOT_FOUND', 'message', 'Lobby not found.');
    END IF;

    IF v_lobby.status IN ('MEMORY', 'PUZZLE') THEN
        RETURN jsonb_build_object('error', 'ALREADY_STARTED', 'message', 'Game has already started. Wait for the next round.');
    END IF;

    v_max := COALESCE(v_lobby.max_players, 8);

    SELECT COUNT(*) INTO v_player_count FROM players WHERE lobby_id = v_lobby.id AND active = TRUE;
    IF v_player_count >= v_max THEN
        RETURN jsonb_build_object('error', 'FULL', 'message', format('Lobby is full (%s/%s). Please wait for the next game.', v_max, v_max));
    END IF;

    IF EXISTS (SELECT 1 FROM players WHERE lobby_id = v_lobby.id AND active = TRUE AND LOWER(TRIM(name)) = LOWER(TRIM(p_name))) THEN
        RETURN jsonb_build_object('error', 'CONFLICT', 'message', 'That name is already taken in this game.');
    END IF;

    SELECT ARRAY_AGG(slot) INTO v_used_slots FROM players WHERE lobby_id = v_lobby.id AND active = TRUE;
    v_slot := 1;
    FOR v_i IN 1..v_max LOOP
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
