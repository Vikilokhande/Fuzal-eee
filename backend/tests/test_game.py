"""Backend engine tests (run with `pytest` from the backend/ directory)."""
from __future__ import annotations

import asyncio

import pytest

from app.models.schemas import GameState, PlayerConnection
from app.services.game_service import GameError, GameService
from app.services.puzzle_service import (
    generate_shuffled_board,
    get_correct_position_for_piece,
    is_piece_correct_at_slot,
    is_solved,
    swap_pieces,
)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def svc() -> GameService:
    return GameService()


# --------- pure puzzle logic ---------

def test_shuffle_never_solved_or_trivial():
    for _ in range(300):
        board = generate_shuffled_board(16)
        assert len(board) == 16
        assert not is_solved(board, 16)
        assert sum(1 for i, x in enumerate(board) if x != i) >= 4
        assert sorted(board) == list(range(16))


def test_swap_is_immutable():
    assert swap_pieces([0, 1, 2, 3], 0, 3) == [3, 1, 2, 0]


def test_canonical_mapping_and_solved_invariants():
    for i in range(16):
        assert get_correct_position_for_piece(i) == i
        assert is_piece_correct_at_slot(i, i) is True
        assert is_piece_correct_at_slot(i, (i + 1) % 16) is False

    solved16 = list(range(16))
    assert is_solved(solved16, 16) is True

    # Rejects invalid lengths
    assert is_solved(list(range(15)), 16) is False
    assert is_solved(list(range(17)), 16) is False

    # Rejects duplicates
    with_dup = list(range(16))
    with_dup[15] = 0
    assert is_solved(with_dup, 16) is False

    # Rejects out-of-bounds
    out_of_bounds = list(range(16))
    out_of_bounds[0] = 99
    assert is_solved(out_of_bounds, 16) is False


# --------- lobby lifecycle ---------

def test_create_and_join(svc):
    lobby = run(svc.create_lobby())
    assert lobby.id.startswith("FZ-")
    assert lobby.status == GameState.LOBBY
    p = run(svc.join(lobby.code, "Chiku"))
    assert p.id.startswith("p_")
    assert len(svc.get(lobby.code).players) == 1


def test_five_player_cap(svc):
    lobby = run(svc.create_lobby())
    for i in range(5):
        run(svc.join(lobby.code, f"P{i}"))
    with pytest.raises(GameError) as exc:
        run(svc.join(lobby.code, "Sixth"))
    assert exc.value.code == "FULL"
    assert exc.value.status == 409


def test_duplicate_names_rejected(svc):
    lobby = run(svc.create_lobby())
    run(svc.join(lobby.code, "Chiku"))
    with pytest.raises(GameError):
        run(svc.join(lobby.code, "chiku"))


def test_start_requires_player_and_host(svc):
    lobby = run(svc.create_lobby())
    with pytest.raises(GameError):
        run(svc.start_game(lobby.code, lobby.host_token))
    run(svc.join(lobby.code, "Chiku"))
    with pytest.raises(GameError):
        run(svc.start_game(lobby.code, "not-the-host-token"))


# --------- state machine, timers, anti-cheat ---------

async def _start_and_puzzle(svc: GameService, n: int = 2):
    lobby = await svc.create_lobby()
    players = [await svc.join(lobby.code, f"P{i}") for i in range(n)]
    await svc.start_game(lobby.code, lobby.host_token)
    assert svc.get(lobby.code).status == GameState.MEMORY
    host_snap = svc.snapshot(svc.get(lobby.code), "host", None)["payload"]
    phone_snap = svc.snapshot(svc.get(lobby.code), "player", players[0])["payload"]
    assert host_snap["image"]["url"]
    assert phone_snap["image"] is None  # never ship the full image to phones
    await svc.begin_puzzle(lobby.code)
    assert svc.get(lobby.code).status == GameState.PUZZLE
    svc._cancel_timers(svc.get(lobby.code))
    return lobby, players


def test_invalid_transition_blocked(svc):
    lobby = run(svc.create_lobby())
    run(svc.join(lobby.code, "P0"))
    with pytest.raises(GameError):
        run(svc.begin_puzzle(lobby.code))
    svc._cancel_timers(svc.get(lobby.code))


def test_puzzle_independent_and_hidden_from_host(svc):
    lobby, players = run(_start_and_puzzle(svc))
    fresh = svc.get(lobby.code)
    boards = [p.puzzle.board for p in fresh.players]
    assert all(not is_solved(b) for b in boards)
    assert len({tuple(b) for b in boards}) == len(boards)  # independent shuffles
    host_snap = svc.snapshot(fresh, "host", None)["payload"]
    assert host_snap["puzzle"] is None  # host never receives arrangements


def one_swap_from_solved(player, pair):
    board = list(range(len(player.puzzle.board)))
    a, b = pair
    board[a], board[b] = board[b], board[a]
    player.puzzle.board = board


def test_winner_and_atomic_race(svc):
    async def scenario():
        lobby, players = await _start_and_puzzle(svc)
        one_swap_from_solved(players[0], (0, 1))
        one_swap_from_solved(players[1], (2, 3))
        results = await asyncio.gather(
            svc.apply_swap(lobby.code, players[0].id, players[0].token, 0, 1),
            svc.apply_swap(lobby.code, players[1].id, players[1].token, 2, 3),
            return_exceptions=True,
        )
        finished = [r for r in results if r is None]
        rejected = [r for r in results if isinstance(r, Exception)]
        assert len(finished) == 1
        assert len(rejected) == 1
        fresh = svc.get(lobby.code)
        assert fresh.status == GameState.FINISHED
        assert fresh.winner_id in {p.id for p in players}
        assert sum(1 for p in fresh.players if p.puzzle.completed) == 1
        assert fresh.players[0].score + fresh.players[1].score == 1

    run(scenario())


def test_moves_rejected_after_finish(svc):
    async def scenario():
        lobby, players = await _start_and_puzzle(svc, 1)
        one_swap_from_solved(players[0], (0, 1))
        await svc.apply_swap(
            lobby.code, players[0].id, players[0].token, 0, 1
        )
        with pytest.raises(GameError):
            await svc.apply_swap(
                lobby.code, players[0].id, players[0].token, 2, 3
            )

    run(scenario())


def test_play_again_and_back_to_lobby(svc):
    async def scenario():
        lobby, players = await _start_and_puzzle(svc, 2)
        one_swap_from_solved(players[0], (0, 1))
        await svc.apply_swap(
            lobby.code, players[0].id, players[0].token, 0, 1
        )
        first_image = svc.get(lobby.code).memory.image["id"]
        await svc.play_again(lobby.code, lobby.host_token)
        fresh = svc.get(lobby.code)
        assert fresh.status == GameState.MEMORY
        assert all(p.puzzle is None for p in fresh.players)
        assert fresh.winner_id is None
        assert fresh.memory.image["id"] != first_image
        await svc.begin_puzzle(lobby.code)
        one_swap_from_solved(players[0], (0, 1))
        await svc.apply_swap(
            lobby.code, players[0].id, players[0].token, 0, 1
        )
        await svc.back_to_lobby(lobby.code, lobby.host_token)
        assert svc.get(lobby.code).status == GameState.LOBBY

    run(scenario())


def test_reconnect_restores_state(svc):
    async def scenario():
        lobby, players = await _start_and_puzzle(svc, 1)
        p = players[0]
        board_before = list(p.puzzle.board)
        p.connection_status = PlayerConnection.DISCONNECTED
        _, restored = await svc.authenticate(
            lobby.code, "player", p.token, p.id
        )
        assert restored.connection_status == PlayerConnection.CONNECTED
        assert restored.puzzle.board == board_before

    run(scenario())
