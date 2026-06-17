"""
routers/trash.py - Soft delete, trash listing, restore, and purge
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from database import get_db
from models import TrashRestoreRequest, TrashPurgeRequest
from ordering import ensure_order_row
from utils import descendant_folder_ids

router = APIRouter()


@router.get("/trash")
def list_trash():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM deleted_items ORDER BY deleted_at DESC"
    ).fetchall()
    conn.close()
    return {
        "items": [
            {
                "id": r["id"],
                "deleted_at": r["deleted_at"],
                "data": json.loads(r["data"])
            }
            for r in rows
        ]
    }


@router.post("/trash/restore")
def restore_trash(req: TrashRestoreRequest):
    conn = get_db()

    for trash_id in req.trash_ids:
        row = conn.execute(
            "SELECT * FROM deleted_items WHERE id=?", (trash_id,)
        ).fetchone()
        if not row:
            continue

        data = json.loads(row["data"])
        folders = data.get("folders", [])
        bookmarks = data.get("bookmarks", [])

        # Sort folders by depth so parents are restored before children
        folders.sort(key=lambda f: f.get("depth", 0))

        # Map old folder IDs to restored folder IDs (in case parent is gone)
        folder_id_map = {}

        for folder in folders:
            old_id = folder["id"]
            old_parent = folder.get("parent_id")

            # Check if original parent exists
            if old_parent:
                parent_exists = conn.execute(
                    "SELECT id FROM folders WHERE id=?", (old_parent,)
                ).fetchone()
                resolved_parent = old_parent if parent_exists else folder_id_map.get(old_parent)
            else:
                resolved_parent = None

            existing = conn.execute(
                "SELECT id FROM folders WHERE id=?", (old_id,)
            ).fetchone()

            if not existing:
                conn.execute(
                    "INSERT INTO folders (id, name, parent_id, vault) VALUES (?,?,?,?)",
                    (old_id, folder["name"], resolved_parent, folder.get("vault", "default"))
                )
                ensure_order_row(conn, resolved_parent, old_id, "folder")

            folder_id_map[old_id] = old_id

        for bm in bookmarks:
            old_folder_id = bm.get("folder_id")

            # Resolve folder — if original folder gone, restore to root
            if old_folder_id:
                folder_exists = conn.execute(
                    "SELECT id FROM folders WHERE id=?", (old_folder_id,)
                ).fetchone()
                resolved_folder = old_folder_id if folder_exists else folder_id_map.get(old_folder_id)
            else:
                resolved_folder = None

            existing = conn.execute(
                "SELECT id FROM bookmarks WHERE id=?", (bm["id"],)
            ).fetchone()

            if not existing:
                conn.execute("""
                    INSERT INTO bookmarks
                        (id, url, url_normalized, title, vault, created_at,
                         archived, screenshot, html_path, screenshot_path,
                         notes, folder_id, favicon_url, favicon_path)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    bm["id"], bm["url"], bm["url_normalized"],
                    bm.get("title", ""), bm.get("vault", "default"),
                    bm.get("created_at"), bm.get("archived", 0),
                    bm.get("screenshot", 0), bm.get("html_path"),
                    bm.get("screenshot_path"), bm.get("notes", ""),
                    resolved_folder, bm.get("favicon_url", ""),
                    bm.get("favicon_path")
                ))
                ensure_order_row(conn, resolved_folder, bm["id"], "bookmark")

                for tag in bm.get("tags", []):
                    conn.execute(
                        "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)",
                        (bm["id"], tag)
                    )

        conn.execute("DELETE FROM deleted_items WHERE id=?", (trash_id,))

    conn.commit()
    conn.close()
    return {"status": "restored"}


@router.post("/trash/purge")
def purge_trash(req: TrashPurgeRequest):
    """Permanently delete specific trash entries and their files."""
    conn = get_db()

    for trash_id in req.trash_ids:
        row = conn.execute(
            "SELECT * FROM deleted_items WHERE id=?", (trash_id,)
        ).fetchone()
        if not row:
            continue

        data = json.loads(row["data"])
        for bm in data.get("bookmarks", []):
            for col in ("screenshot_path", "html_path", "favicon_path"):
                p = bm.get(col)
                if p and Path(p).exists():
                    Path(p).unlink()

        conn.execute("DELETE FROM deleted_items WHERE id=?", (trash_id,))

    conn.commit()
    conn.close()
    return {"status": "purged"}


@router.post("/trash/purge-expired")
def purge_expired():
    """Called by the cron job — wipes entries older than 7 days."""
    conn = get_db()
    cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()

    rows = conn.execute(
        "SELECT * FROM deleted_items WHERE deleted_at < ?", (cutoff,)
    ).fetchall()

    for row in rows:
        data = json.loads(row["data"])
        for bm in data.get("bookmarks", []):
            for col in ("screenshot_path", "html_path", "favicon_path"):
                p = bm.get(col)
                if p and Path(p).exists():
                    Path(p).unlink()

    conn.execute("DELETE FROM deleted_items WHERE deleted_at < ?", (cutoff,))
    conn.commit()
    conn.close()
    return {"status": "ok"}