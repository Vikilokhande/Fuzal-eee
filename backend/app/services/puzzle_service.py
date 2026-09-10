"""Pure puzzle helpers (mirror of the TypeScript engine)."""
from __future__ import annotations

import random


def fisher_yates(items: list[int]) -> list[int]:
    arr = list(items)
    for i in range(len(arr) - 1, 0, -1):
        j = random.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def is_solved(board: list[int]) -> bool:
    return all(piece == slot for slot, piece in enumerate(board))


def misplaced_count(board: list[int]) -> int:
    return sum(1 for slot, piece in enumerate(board) if piece != slot)


def generate_shuffled_board(piece_count: int) -> list[int]:
    """Random board that is never solved and never trivially one move away."""
    solved = list(range(piece_count))
    for _ in range(200):
        board = fisher_yates(solved)
        if not is_solved(board) and misplaced_count(board) >= 4:
            return board
    return [(i + piece_count // 2) % piece_count for i in solved]


def swap_pieces(board: list[int], a: int, b: int) -> list[int]:
    nxt = list(board)
    nxt[a], nxt[b] = nxt[b], nxt[a]
    return nxt


def correct_slots(board: list[int]) -> list[bool]:
    return [piece == slot for slot, piece in enumerate(board)]
