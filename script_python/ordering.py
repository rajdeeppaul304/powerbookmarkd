"""
ordering.py - Floating-point position management for item_order table
"""

import sqlite3
from typing import Optional

REBALANCE_THRESHOLD = 0.0001
REBALANCE_GAP       = 1000.0


def get_next_position(conn: sqlite3.Connection, folder_id: Optional[str]) -> float:
    """Return a position value that places a new item at the bottom of a folder."""
    if folder_id is None:
        row = conn.execute(
            "SELECT MAX(position) FROM item_order WHERE folder_id IS NULL"
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT MAX(position) FROM item_order WHERE folder_id=?", (folder_id,)
        ).fetchone()
    max_pos = row[0] if row and row[0] is not None else 0.0
    return max_pos + REBALANCE_GAP


def ensure_order_row(
    conn: sqlite3.Connection,
    folder_id: Optional[str],
    item_id: str,
    item_type: str,
):
    """Insert an item_order row if one doesn't already exist (new item goes to bottom)."""
    existing = conn.execute(
        "SELECT position FROM item_order WHERE item_id=? AND item_type=?",
        (item_id, item_type)
    ).fetchone()
    if existing:
        return
    pos = get_next_position(conn, folder_id)
    conn.execute(
        "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
        (folder_id, item_id, item_type, pos)
    )


def move_order_row(
    conn: sqlite3.Connection,
    folder_id: Optional[str],
    item_id: str,
    item_type: str,
):
    """Move an existing order row to a different folder (item goes to bottom of target)."""
    conn.execute(
        "DELETE FROM item_order WHERE item_id=? AND item_type=?",
        (item_id, item_type)
    )
    pos = get_next_position(conn, folder_id)
    conn.execute(
        "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
        (folder_id, item_id, item_type, pos)
    )


def rebalance_if_needed(conn: sqlite3.Connection, folder_id: Optional[str]):
    """
    If any adjacent positions are too close together, reassign clean
    integer-spaced positions to all items in this folder.
    Only touches item_order — never bookmarks/folders tables.
    """
    if folder_id is None:
        rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order "
            "WHERE folder_id IS NULL ORDER BY position"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order "
            "WHERE folder_id=? ORDER BY position",
            (folder_id,)
        ).fetchall()

    needs_rebalance = any(
        abs(rows[i + 1]["position"] - rows[i]["position"]) < REBALANCE_THRESHOLD
        for i in range(len(rows) - 1)
    )

    if needs_rebalance:
        for i, row in enumerate(rows):
            conn.execute(
                "UPDATE item_order SET position=? WHERE item_id=? AND item_type=?",
                (float((i + 1) * REBALANCE_GAP), row["item_id"], row["item_type"])
            )