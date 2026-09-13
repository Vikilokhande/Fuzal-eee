"""Pure puzzle helpers (mirror of the TypeScript engine)."""
from __future__ import annotations

import random


def get_correct_position_for_piece(piece_id: int) -> int:
    """Canonical mapping: pieceId -> correctPosition."""
    return int(piece_id)


def is_piece_correct_at_slot(piece_id: int, slot: int) -> bool:
    """Checks if pieceId is placed in its canonical solved slot."""
    return get_correct_position_for_piece(piece_id) == slot


def fisher_yates(items: list[int]) -> list[int]:
    arr = list(items)
    for i in range(len(arr) - 1, 0, -1):
        j = random.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def is_solved(board: list[int], piece_count: int | None = None) -> bool:
    """Validates that all positions on the board match the solved mapping."""
    if not isinstance(board, list) or len(board) == 0:
        return False
    count = piece_count if piece_count is not None else len(board)
    if len(board) != count:
        return False
    seen = set()
    for slot, piece in enumerate(board):
        try:
            p = int(piece)
        except (ValueError, TypeError):
            return False
        if p < 0 or p >= count or p in seen:
            return False
        seen.add(p)
        if not is_piece_correct_at_slot(p, slot):
            return False
    return len(seen) == count


def misplaced_count(board: list[int]) -> int:
    return sum(1 for slot, piece in enumerate(board) if not is_piece_correct_at_slot(piece, slot))


def generate_shuffled_board(piece_count: int) -> list[int]:
    """Random board that is never solved and never trivially one move away."""
    solved = list(range(piece_count))
    for _ in range(200):
        board = fisher_yates(solved)
        if not is_solved(board, piece_count) and misplaced_count(board) >= 4:
            return board
    return [(i + piece_count // 2) % piece_count for i in solved]


def swap_pieces(board: list[int], a: int, b: int) -> list[int]:
    nxt = list(board)
    nxt[a], nxt[b] = nxt[b], nxt[a]
    return nxt


def correct_slots(board: list[int]) -> list[bool]:
    return [is_piece_correct_at_slot(piece, slot) for slot, piece in enumerate(board)]
