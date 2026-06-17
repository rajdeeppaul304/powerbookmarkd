"""
routers/bookmarks.py - Core bookmark CRUD, search, and lookup endpoints
"""

import base64
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional
from state import broadcast_sync

from fastapi import APIRouter, HTTPException, Query

from database import get_db, ARCHIVE_DIR, FAVICON_DIR
from models import (
    SaveRequest,
    BookmarkMove,
    BookmarkTagPatch,
    BookmarkNotesPatch,
    BookmarkUpdate,
)
from ordering import ensure_order_row, move_order_row
from utils import normalize_url, make_id, enrich_bookmark, row_to_dict

router = APIRouter()


def _validate_folder(conn, folder_id: Optional[str]):
    if folder_id is None:
        return
    row = conn.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Folder '{folder_id}' not found")


# ── Save / upsert ─────────────────────────────────────────────────────────────

@router.post("/save")
def save(req: SaveRequest):
    norm = normalize_url(req.url)
    bid  = make_id(norm)
    conn = get_db()

    if req.folder_id:
        _validate_folder(conn, req.folder_id)

    existing = conn.execute(
        "SELECT id, folder_id FROM bookmarks WHERE url_normalized=?", (norm,)
    ).fetchone()

    ss_path = html_path = fav_path = None

    # ── Screenshot ────────────────────────────────────────────────────────────
    if req.screenshot_data:
        try:
            raw     = base64.b64decode(req.screenshot_data.split(",")[-1])
            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            Path(ss_path).write_bytes(raw)
        except Exception as exc:
            print(f"Screenshot save failed: {exc}")
    else:
        potential = ARCHIVE_DIR / f"{bid}.jpeg"
        if potential.exists():
            ss_path = str(potential)

    # ── HTML archive ──────────────────────────────────────────────────────────
    if req.archive:
        if req.html_data:
            try:
                raw       = base64.b64decode(req.html_data)
                html_path = str(ARCHIVE_DIR / f"{bid}.html")
                Path(html_path).write_bytes(raw)
            except Exception as exc:
                print(f"HTML archive save failed: {exc}")
        else:
            potential = ARCHIVE_DIR / f"{bid}.html"
            if potential.exists():
                html_path = str(potential)

    # ── Favicon ───────────────────────────────────────────────────────────────
    potential_fav = FAVICON_DIR / f"{bid}.ico"
    if potential_fav.exists():
        fav_path = str(potential_fav)
    elif req.favicon_url:
        if req.favicon_url.startswith("data:image"):
            try:
                _, encoded = req.favicon_url.split(",", 1)
                potential_fav.write_bytes(base64.b64decode(encoded))
                fav_path = str(potential_fav)
            except Exception as exc:
                print(f"Failed to save base64 favicon: {exc}")
        elif req.favicon_url.startswith("http"):
            try:
                r = urllib.request.Request(
                    req.favicon_url, headers={"User-Agent": "Mozilla/5.0"}
                )
                with urllib.request.urlopen(r, timeout=5) as response:
                    potential_fav.write_bytes(response.read())
                fav_path = str(potential_fav)
            except Exception as exc:
                print(f"Failed to download favicon: {exc}")

    now         = datetime.utcnow().isoformat()
    favicon_url = (req.favicon_url or "").strip()

    if existing:
        old_folder_id = existing["folder_id"]
        conn.execute("""
            UPDATE bookmarks SET
                title=?, vault=?, archived=?, screenshot=?,
                html_path=?, screenshot_path=?, favicon_path=?, notes=?, folder_id=?, favicon_url=?
            WHERE id=?
        """, (
            req.title, req.vault,
            1 if (req.archive and html_path) else 0,
            1 if ss_path else 0,
            html_path, ss_path, fav_path, req.notes, req.folder_id, favicon_url, bid,
        ))
        if old_folder_id != req.folder_id:
            move_order_row(conn, req.folder_id, bid, "bookmark")
        action = "updated"
    else:
        conn.execute("""
            INSERT INTO bookmarks
                (id, url, url_normalized, title, vault, created_at,
                 archived, screenshot, html_path, screenshot_path, favicon_path, notes, folder_id, favicon_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            bid, req.url, norm, req.title, req.vault, now,
            1 if (req.archive and html_path) else 0,
            1 if ss_path else 0,
            html_path, ss_path, fav_path, req.notes, req.folder_id, favicon_url,
        ))
        ensure_order_row(conn, req.folder_id, bid, "bookmark")
        action = "saved"

    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    for tag in set(req.tags):
        tag = tag.strip().lower()
        if tag:
            conn.execute(
                "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag)
            )

    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    conn.close()
    return {"id": bid, "status": action}


# ── Get / delete ──────────────────────────────────────────────────────────────

@router.get("/bookmark/{bid}")
def get_bookmark(bid: str):
    conn = get_db()
    row  = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    d = enrich_bookmark(conn, row)
    conn.close()
    return d


@router.delete("/bookmark/{bid}")
def delete_bookmark(bid: str):
    conn = get_db()
    row  = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")

    d = dict(row)
    for col in ("screenshot_path", "html_path", "favicon_path"):
        p = d.get(col)
        if p:
            shared = conn.execute(
                f"SELECT COUNT(*) FROM bookmarks WHERE {col}=? AND id!=?", (p, bid)
            ).fetchone()[0]
            if shared == 0 and Path(p).exists():
                Path(p).unlink()

    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    conn.execute("DELETE FROM item_order WHERE item_id=? AND item_type='bookmark'", (bid,))
    conn.execute("DELETE FROM bookmarks WHERE id=?", (bid,))
    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    conn.close()
    return {"status": "deleted"}


# ── Patch endpoints ───────────────────────────────────────────────────────────

@router.patch("/bookmark/{bid}/move")
def move_bookmark(bid: str, req: BookmarkMove):
    conn = get_db()
    row  = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    _validate_folder(conn, req.folder_id)
    conn.execute("UPDATE bookmarks SET folder_id=? WHERE id=?", (req.folder_id, bid))
    move_order_row(conn, req.folder_id, bid, "bookmark")
    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


@router.patch("/bookmark/{bid}/tags")
def patch_tags(bid: str, req: BookmarkTagPatch):
    conn = get_db()
    row  = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    clean_tags = list({t.strip().lower() for t in req.tags if t.strip()})
    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    for tag in clean_tags:
        conn.execute(
            "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag)
        )
    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


@router.patch("/bookmark/{bid}/notes")
def patch_notes(bid: str, req: BookmarkNotesPatch):
    conn = get_db()
    row  = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    conn.execute("UPDATE bookmarks SET notes=? WHERE id=?", (req.notes, bid))
    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


@router.patch("/bookmark/{bid}")
def update_bookmark(bid: str, req: BookmarkUpdate):
    conn = get_db()
    row  = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    conn.execute(
        "UPDATE bookmarks SET title=?, url=?, notes=? WHERE id=?",
        (req.title.strip(), req.url.strip(), req.notes.strip(), bid)
    )
    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    for tag in req.tags:
        clean = tag.strip().lower()
        if clean:
            conn.execute(
                "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, clean)
            )
    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


# ── Search / browse ───────────────────────────────────────────────────────────

@router.get("/search")
def search(
    q: str = Query(...),
    vault: Optional[str] = None,
    folder_id: Optional[str] = Query(default=None),
    limit: int = 50,
):
    conn     = get_db()
    safe_q   = q.replace('"', '""')
    fts_query = f'"{safe_q}"*'

    if vault and folder_id:
        rows = conn.execute("""
            SELECT b.* FROM bookmarks b
            JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
            WHERE bookmarks_fts MATCH ? AND b.vault=? AND b.folder_id=?
            ORDER BY rank LIMIT ?
        """, (fts_query, vault, folder_id, limit)).fetchall()
    elif vault:
        rows = conn.execute("""
            SELECT b.* FROM bookmarks b
            JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
            WHERE bookmarks_fts MATCH ? AND b.vault=?
            ORDER BY rank LIMIT ?
        """, (fts_query, vault, limit)).fetchall()
    else:
        rows = conn.execute("""
            SELECT b.* FROM bookmarks b
            JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
            WHERE bookmarks_fts MATCH ?
            ORDER BY rank LIMIT ?
        """, (fts_query, limit)).fetchall()

    results = [enrich_bookmark(conn, r) for r in rows]
    conn.close()
    return {"results": results, "count": len(results)}


@router.get("/recent")
def recent(limit: int = 20):
    conn    = get_db()
    rows    = conn.execute(
        "SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    results = [enrich_bookmark(conn, r) for r in rows]
    conn.close()
    return {"bookmarks": results}


@router.get("/lookup")
def lookup(url: str = Query(...)):
    norm = normalize_url(url)
    conn = get_db()
    row  = conn.execute(
        "SELECT * FROM bookmarks WHERE url_normalized=?", (norm,)
    ).fetchone()
    conn.close()
    if not row:
        return {"exists": False}
    return {
        "exists":      True,
        "bookmark_id": row["id"],
        "vault":       row["vault"],
        "archived":    bool(row["archived"]),
        "screenshot":  bool(row["screenshot"]),
        "folder_id":   row["folder_id"],
        "favicon_url": row["favicon_url"] or "",
    }