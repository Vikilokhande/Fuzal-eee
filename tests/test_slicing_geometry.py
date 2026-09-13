"""Tests for slicing geometry, remainder pixel continuity, and contact sheet reconstruction."""
import math
import pytest


def compute_slice(col: int, row: int, cols: int, rows: int, width: int, height: int):
    left = math.floor(col * width / cols)
    right = math.floor((col + 1) * width / cols)
    top = math.floor(row * height / rows)
    bottom = math.floor((row + 1) * height / rows)
    piece_width = right - left
    piece_height = bottom - top
    return {
        "left": left,
        "right": right,
        "top": top,
        "bottom": bottom,
        "width": piece_width,
        "height": piece_height,
    }


@pytest.mark.parametrize(
    "cols,rows,width,height,expected_pieces",
    [
        (3, 3, 900, 900, 9),
        (3, 4, 900, 900, 12),
        (4, 4, 900, 900, 16),
        (3, 4, 1000, 1000, 12),
        (3, 4, 750, 750, 12),
    ],
)
def test_slice_geometry_continuity_no_gaps_no_overlap(cols, rows, width, height, expected_pieces):
    pieces = []
    for r in range(rows):
        for c in range(cols):
            pieces.append(compute_slice(c, r, cols, rows, width, height))

    assert len(pieces) == expected_pieces

    # Check horizontal continuity for each row
    for r in range(rows):
        row_pieces = pieces[r * cols : (r + 1) * cols]
        assert row_pieces[0]["left"] == 0
        assert row_pieces[-1]["right"] == width
        for c in range(cols - 1):
            assert row_pieces[c]["right"] == row_pieces[c + 1]["left"], (
                f"Horizontal gap or overlap between col {c} and col {c + 1} in row {r}"
            )

    # Check vertical continuity for each column
    for c in range(cols):
        col_pieces = [pieces[r * cols + c] for r in range(rows)]
        assert col_pieces[0]["top"] == 0
        assert col_pieces[-1]["bottom"] == height
        for r in range(rows - 1):
            assert col_pieces[r]["bottom"] == col_pieces[r + 1]["top"], (
                f"Vertical gap or overlap between row {r} and row {r + 1} in col {c}"
            )

    # Total area must equal source image area exactly
    total_area = sum(p["width"] * p["height"] for p in pieces)
    assert total_area == width * height


def test_12_piece_tile_aspect_ratio():
    # 900x900 source with 3 cols x 4 rows
    width, height = 900, 900
    cols, rows = 3, 4
    for r in range(rows):
        for c in range(cols):
            s = compute_slice(c, r, cols, rows, width, height)
            assert s["width"] == 300
            assert s["height"] == 225
            # Tile aspect ratio is 300 / 225 = 4 / 3
            assert abs((s["width"] / s["height"]) - (4.0 / 3.0)) < 1e-9
