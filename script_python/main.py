"""
powerbookmarkd - Local bookmark archiving service
Run: uvicorn main:app --host 127.0.0.1 --port 8765
"""

import sqlite3
import hashlib
import os
import json
import base64
import re
import asyncio
import urllib.request
from pathlib import Path
from datetime import datetime
from typing import Optional, List
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil

from playwright.async_api import async_playwright

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent / "data"
DB_PATH     = BASE_DIR / "bookmarks.db"
ARCHIVE_DIR = BASE_DIR / "archive"
FAVICON_DIR = BASE_DIR / "favicons"

BASE_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
FAVICON_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="powerbookmarkd", version="1.3.0")
app.mount("/static/archive", StaticFiles(directory=str(ARCHIVE_DIR)), name="archive")
app.mount("/static/favicons", StaticFiles(directory=str(FAVICON_DIR)), name="favicons")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── DB setup ──────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.executescript("""
        CREATE TABLE IF NOT EXISTS bookmarks (
            id               TEXT PRIMARY KEY,
            url              TEXT NOT NULL,
            url_normalized   TEXT NOT NULL,
            title            TEXT,
            vault            TEXT DEFAULT 'default',
            created_at       TEXT NOT NULL,
            archived         INTEGER DEFAULT 0,
            screenshot       INTEGER DEFAULT 0,
            html_path        TEXT,
            screenshot_path  TEXT,
            favicon_path     TEXT,
            favicon_url      TEXT DEFAULT '',
            notes            TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS tags (
            bookmark_id TEXT NOT NULL,
            tag         TEXT NOT NULL,
            UNIQUE(bookmark_id, tag)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
            title,
            url,
            notes,
            content=bookmarks,
            content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS bookmarks_ai AFTER INSERT ON bookmarks BEGIN
            INSERT INTO bookmarks_fts(rowid, title, url, notes)
            VALUES (new.rowid, new.title, new.url, new.notes);
        END;

        CREATE TRIGGER IF NOT EXISTS bookmarks_au AFTER UPDATE ON bookmarks BEGIN
            INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, url, notes)
            VALUES ('delete', old.rowid, old.title, old.url, old.notes);
            INSERT INTO bookmarks_fts(rowid, title, url, notes)
            VALUES (new.rowid, new.title, new.url, new.notes);
        END;

        CREATE TRIGGER IF NOT EXISTS bookmarks_ad AFTER DELETE ON bookmarks BEGIN
            INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, url, notes)
            VALUES ('delete', old.rowid, old.title, old.url, old.notes);
        END;

        CREATE TABLE IF NOT EXISTS folders (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            parent_id TEXT,
            vault     TEXT DEFAULT 'default',
            FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS item_order (
            folder_id  TEXT,
            item_id    TEXT NOT NULL,
            item_type  TEXT NOT NULL CHECK(item_type IN ('bookmark', 'folder')),
            position   REAL NOT NULL,
            PRIMARY KEY (item_id, item_type)
        );

        CREATE INDEX IF NOT EXISTS idx_item_order_folder ON item_order(folder_id, position);
    """)

    # Live migrations: add columns if absent
    existing_cols = {
        row[1]
        for row in c.execute("PRAGMA table_info(bookmarks)").fetchall()
    }
    if "folder_id" not in existing_cols:
        c.execute("ALTER TABLE bookmarks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL")
    if "favicon_url" not in existing_cols:
        c.execute("ALTER TABLE bookmarks ADD COLUMN favicon_url TEXT DEFAULT ''")
    if "favicon_path" not in existing_cols:
        c.execute("ALTER TABLE bookmarks ADD COLUMN favicon_path TEXT")

    conn.commit()
    conn.close()

init_db()

# ── URL normalization ─────────────────────────────────────────────────────────
TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "ref", "source", "mc_eid", "mc_cid",
}

def normalize_url(url: str) -> str:
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
    parsed = urlparse(url.strip())
    qs = parse_qs(parsed.query, keep_blank_values=True)
    clean_qs = {k: v for k, v in qs.items() if k.lower() not in TRACKING_PARAMS}
    clean_query = urlencode(clean_qs, doseq=True)
    path = parsed.path.rstrip("/") or "/"
    normalized = urlunparse((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        path,
        parsed.params,
        clean_query,
        ""
    ))
    return normalized

def make_id(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()[:8]

def make_folder_id() -> str:
    return os.urandom(16).hex()[:8]

# ── JS Snippet to find Favicons ───────────────────────────────────────────────
JS_GET_FAVICON = """() => {
    let el = document.querySelector('link[rel~="icon"]');
    if (!el) el = document.querySelector('link[rel="shortcut icon"]');
    return el ? el.href : new URL('/favicon.ico', document.baseURI).href;
}"""

# ── Ordering helpers ──────────────────────────────────────────────────────────
REBALANCE_THRESHOLD = 0.0001
REBALANCE_GAP = 1000.0

def get_next_position(conn, folder_id: Optional[str], item_type: str = None) -> float:
    """Return position value that places a new item at the bottom of a folder."""
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

def ensure_order_row(conn, folder_id: Optional[str], item_id: str, item_type: str):
    """Insert an item_order row if it doesn't already exist (new item goes to bottom)."""
    existing = conn.execute(
        "SELECT position FROM item_order WHERE item_id=? AND item_type=?",
        (item_id, item_type)
    ).fetchone()
    if existing:
        return
    pos = get_next_position(conn, folder_id, item_type)
    conn.execute(
        "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
        (folder_id, item_id, item_type, pos)
    )

def move_order_row(conn, folder_id: Optional[str], item_id: str, item_type: str):
    """Update folder_id for an existing order row (item moved to different folder)."""
    conn.execute(
        "DELETE FROM item_order WHERE item_id=? AND item_type=?",
        (item_id, item_type)
    )
    pos = get_next_position(conn, folder_id, item_type)
    conn.execute(
        "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
        (folder_id, item_id, item_type, pos)
    )

def rebalance_if_needed(conn, folder_id: Optional[str]):
    """
    Check if any adjacent positions are too close. If so, reassign clean
    integer-spaced positions to all items in this folder.
    Only touches item_order, never the bookmarks/folders tables.
    """
    if folder_id is None:
        rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order WHERE folder_id IS NULL ORDER BY position"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order WHERE folder_id=? ORDER BY position",
            (folder_id,)
        ).fetchall()

    needs_rebalance = False
    for i in range(len(rows) - 1):
        if abs(rows[i+1]["position"] - rows[i]["position"]) < REBALANCE_THRESHOLD:
            needs_rebalance = True
            break

    if needs_rebalance:
        for i, row in enumerate(rows):
            conn.execute(
                "UPDATE item_order SET position=? WHERE item_id=? AND item_type=?",
                (float((i + 1) * REBALANCE_GAP), row["item_id"], row["item_type"])
            )

# ── Models ────────────────────────────────────────────────────────────────────
class SaveRequest(BaseModel):
    url: str
    title: str = ""
    vault: str = "default"
    tags: List[str] = []
    archive: bool = False
    screenshot: bool = True
    notes: str = ""
    folder_id: Optional[str] = None
    favicon_url: Optional[str] = None
    screenshot_data: Optional[str] = None
    html_data: Optional[str] = None

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None
    vault: str = "default"

class FolderRename(BaseModel):
    name: str

class FolderMove(BaseModel):
    parent_id: Optional[str] = None

class BookmarkMove(BaseModel):
    folder_id: Optional[str] = None

class BulkMoveRequest(BaseModel):
    ids: List[str]
    folder_id: Optional[str] = None

class BulkCopyRequest(BaseModel):
    ids: List[str]
    folder_id: Optional[str] = None
    vault: Optional[str] = None

class BulkTagRequest(BaseModel):
    ids: List[str]
    add: List[str] = []
    remove: List[str] = []

class BookmarkTagPatch(BaseModel):
    tags: List[str]

class BookmarkNotesPatch(BaseModel):
    notes: str

class FetchMetaRequest(BaseModel):
    url: str
    archive: bool = False

class BookmarkFetchRequest(BaseModel):
    archive: bool = False

class BulkFetchRequest(BaseModel):
    ids: List[str]
    archive: bool = False

class OrderItem(BaseModel):
    item_id: str
    item_type: str  # 'bookmark' | 'folder'

class SetFolderOrderRequest(BaseModel):
    """
    Full ordered list of items for a folder.
    Positions are assigned using floating-point gaps.
    folder_id=None means root level.
    """
    folder_id: Optional[str] = None
    items: List[OrderItem]
class BulkFolderMoveRequest(BaseModel):
    ids: List[str]
    target_parent_id: Optional[str] = None
    
class BulkDeleteRequest(BaseModel):
    bookmark_ids: list[str]
    folder_ids: list[str]
    
    # ── Helpers ───────────────────────────────────────────────────────────────────
def row_to_dict(row) -> dict:
    return dict(row)

def get_tags(conn, bookmark_id: str) -> List[str]:
    rows = conn.execute("SELECT tag FROM tags WHERE bookmark_id=?", (bookmark_id,)).fetchall()
    return [r["tag"] for r in rows]

def enrich_bookmark(conn, row) -> dict:
    d = row_to_dict(row)
    d["tags"]       = get_tags(conn, d["id"])
    d["archived"]   = bool(d["archived"])
    d["screenshot"] = bool(d["screenshot"])
    return d

def _validate_folder(conn, folder_id: Optional[str]):
    if folder_id is None:
        return
    row = conn.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Folder '{folder_id}' not found")

def _folder_counts(conn, folder_id: Optional[str], vault: str) -> dict:
    if folder_id:
        sf_count = conn.execute("SELECT COUNT(*) FROM folders WHERE parent_id=? AND vault=?", (folder_id, vault)).fetchone()[0]
        bm_count = conn.execute("SELECT COUNT(*) FROM bookmarks WHERE folder_id=? AND vault=?", (folder_id, vault)).fetchone()[0]
    else:
        sf_count = conn.execute("SELECT COUNT(*) FROM folders WHERE parent_id IS NULL AND vault=?", (vault,)).fetchone()[0]
        bm_count = conn.execute("SELECT COUNT(*) FROM bookmarks WHERE folder_id IS NULL AND vault=?", (vault,)).fetchone()[0]
    return {"subfolder_count": sf_count, "bookmark_count": bm_count}

def descendant_folder_ids(conn, folder_id: str) -> set:
    result = {folder_id}
    queue  = [folder_id]
    while queue:
        current = queue.pop()
        children = conn.execute("SELECT id FROM folders WHERE parent_id=?", (current,)).fetchall()
        for child in children:
            cid = child["id"]
            if cid not in result:
                result.add(cid)
                queue.append(cid)
    return result

def get_ordered_contents(conn, folder_id: Optional[str], vault: str, archived: Optional[bool] = None) -> dict:
    """
    Returns subfolders and bookmarks for a folder, sorted by item_order position.
    Items without an order row get position=infinity (appear at the end).
    Returns combined list with item_type attached, plus separate lists for compatibility.
    """
    # Fetch subfolders
    if folder_id:
        subfolder_rows = conn.execute(
            "SELECT * FROM folders WHERE parent_id=? AND vault=? ORDER BY name",
            (folder_id, vault)
        ).fetchall()
    else:
        subfolder_rows = conn.execute(
            "SELECT * FROM folders WHERE parent_id IS NULL AND vault=? ORDER BY name",
            (vault,)
        ).fetchall()

    subfolders = []
    for r in subfolder_rows:
        d = row_to_dict(r)
        counts = _folder_counts(conn, d["id"], vault)
        d.update(counts)
        subfolders.append(d)

    # Fetch bookmarks
    base_query = "SELECT * FROM bookmarks WHERE vault=? AND "
    if folder_id:
        base_query += "folder_id=?"
        params: tuple = (vault, folder_id)
    else:
        base_query += "folder_id IS NULL"
        params = (vault,)

    if archived is not None:
        base_query += " AND archived=?"
        params += (1 if archived else 0,)

    base_query += " ORDER BY created_at DESC"
    bookmark_rows = conn.execute(base_query, params).fetchall()
    bookmarks = [enrich_bookmark(conn, r) for r in bookmark_rows]

    # Fetch order map for this folder
    if folder_id is None:
        order_rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order WHERE folder_id IS NULL"
        ).fetchall()
    else:
        order_rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order WHERE folder_id=?",
            (folder_id,)
        ).fetchall()

    order_map = {(r["item_id"], r["item_type"]): r["position"] for r in order_rows}

    UNORDERED_POS = 1e9  # float("inf") is not JSON-serializable

    for f in subfolders:
        f["position"] = order_map.get((f["id"], "folder"), UNORDERED_POS)
        f["item_type"] = "folder"

    for b in bookmarks:
        b["position"] = order_map.get((b["id"], "bookmark"), UNORDERED_POS)
        b["item_type"] = "bookmark"


    # Build interleaved sorted list (for list view)
    all_items = sorted(subfolders + bookmarks, key=lambda x: x["position"])

    return {
        "current_folder_id": folder_id,
        "subfolders": subfolders,   # kept for grid view / sidebar compat
        "bookmarks": bookmarks,     # kept for compat
        "ordered_items": all_items, # new: interleaved sorted list for list view
    }

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "powerbookmarkd", "version": "1.3.0"}

# ── Order endpoint ────────────────────────────────────────────────────────────
@app.post("/folder/order")
def set_folder_order(req: SetFolderOrderRequest):
    """
    Accepts the full ordered list of items for a folder and assigns
    floating-point positions with REBALANCE_GAP spacing.
    Rebalances if any gap drops below REBALANCE_THRESHOLD.
    """
    conn = get_db()

    if req.folder_id is not None:
        _validate_folder(conn, req.folder_id)

    # Validate item_types
    for item in req.items:
        if item.item_type not in ("bookmark", "folder"):
            conn.close()
            raise HTTPException(400, f"Invalid item_type '{item.item_type}'")

    # Assign positions with clean gaps
    for i, item in enumerate(req.items):
        pos = float((i + 1) * REBALANCE_GAP)
        existing = conn.execute(
            "SELECT position FROM item_order WHERE item_id=? AND item_type=?",
            (item.item_id, item.item_type)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE item_order SET folder_id=?, position=? WHERE item_id=? AND item_type=?",
                (req.folder_id, pos, item.item_id, item.item_type)
            )
        else:
            conn.execute(
                "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
                (req.folder_id, item.item_id, item.item_type, pos)
            )

    conn.commit()
    conn.close()
    return {"status": "ok", "folder_id": req.folder_id, "count": len(req.items)}

@app.get("/folder/{folder_id}/order")
def get_folder_order(folder_id: str):
    """Get the ordered item list for a specific folder."""
    conn = get_db()
    rows = conn.execute(
        "SELECT item_id, item_type, position FROM item_order WHERE folder_id=? ORDER BY position",
        (folder_id,)
    ).fetchall()
    conn.close()
    return {"folder_id": folder_id, "items": [dict(r) for r in rows]}

@app.get("/root/order")
def get_root_order():
    """Get the ordered item list for root level (folder_id IS NULL)."""
    conn = get_db()
    rows = conn.execute(
        "SELECT item_id, item_type, position FROM item_order WHERE folder_id IS NULL ORDER BY position"
    ).fetchall()
    conn.close()
    return {"folder_id": None, "items": [dict(r) for r in rows]}

# ── Folder endpoints ──────────────────────────────────────────────────────────
@app.post("/folders", status_code=201)
def create_folder(req: FolderCreate):
    conn = get_db()
    if req.parent_id:
        parent = conn.execute("SELECT id FROM folders WHERE id=?", (req.parent_id,)).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(404, f"Parent folder '{req.parent_id}' not found")

    for _ in range(5):
        fid = make_folder_id()
        clash = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
        if not clash:
            break
    else:
        conn.close()
        raise HTTPException(500, "Could not generate unique folder id")

    conn.execute("INSERT INTO folders (id, name, parent_id, vault) VALUES (?,?,?,?)", (fid, req.name.strip(), req.parent_id, req.vault))

    # Add order row — new folder goes to bottom of its parent
    ensure_order_row(conn, req.parent_id, fid, "folder")

    conn.commit()
    row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(row)

@app.patch("/folders/{fid}")
def rename_folder(fid: str, req: FolderRename):
    if not req.name.strip(): raise HTTPException(400, "Folder name cannot be empty")
    conn = get_db()
    row = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")
    conn.execute("UPDATE folders SET name=? WHERE id=?", (req.name.strip(), fid))
    conn.commit()
    updated = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(updated)

@app.post("/folders/{fid}/move")
def move_folder(fid: str, req: FolderMove):
    conn = get_db()
    row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")

    if req.parent_id is not None:
        parent = conn.execute("SELECT id FROM folders WHERE id=?", (req.parent_id,)).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(404, f"Target parent folder '{req.parent_id}' not found")

    descendants = descendant_folder_ids(conn, fid)
    if req.parent_id in descendants:
        conn.close()
        raise HTTPException(400, "Cannot move a folder into itself or one of its descendants")

    conn.execute("UPDATE folders SET parent_id=? WHERE id=?", (req.parent_id, fid))

    # Move order row to new parent (goes to bottom)
    move_order_row(conn, req.parent_id, fid, "folder")

    conn.commit()
    updated = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(updated)

@app.delete("/folders/{fid}")
def delete_folder(fid: str):
    conn = get_db()
    row = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")
    # Clean up order rows for this folder's contents
    conn.execute("DELETE FROM item_order WHERE folder_id=?", (fid,))
    # Clean up this folder's own order row
    conn.execute("DELETE FROM item_order WHERE item_id=? AND item_type='folder'", (fid,))
    conn.execute("DELETE FROM folders WHERE id=?", (fid,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "id": fid}

@app.get("/folders/{fid}/path")
def folder_path(fid: str):
    MAX_DEPTH = 50
    conn = get_db()
    row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")

    chain, seen, current = [], set(), row_to_dict(row)
    while current:
        cid = current["id"]
        if cid in seen:
            conn.close()
            raise HTTPException(500, "Cycle detected in folder hierarchy")
        seen.add(cid)
        chain.append({"id": cid, "name": current["name"]})
        if len(chain) > MAX_DEPTH:
            conn.close()
            raise HTTPException(500, "Folder depth exceeds maximum allowed depth")
        pid = current.get("parent_id")
        if pid:
            parent_row = conn.execute("SELECT * FROM folders WHERE id=?", (pid,)).fetchone()
            current = row_to_dict(parent_row) if parent_row else None
        else:
            current = None

    conn.close()
    chain.reverse()
    ancestors = chain[:-1]
    return {"breadcrumb": chain, "ancestors": ancestors}

# ── Contents ──────────────────────────────────────────────────────────────────
@app.get("/contents")
def get_contents(
    folder_id: Optional[str] = Query(default=None),
    vault: str = Query(default="default"),
    archived: Optional[bool] = Query(default=None)
):
    conn = get_db()
    result = get_ordered_contents(conn, folder_id, vault, archived)
    conn.close()
    return result

# ── Single bookmark updates ───────────────────────────────────────────────────
@app.patch("/bookmark/{bid}/move")
def move_bookmark(bid: str, req: BookmarkMove):
    conn = get_db()
    row = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    _validate_folder(conn, req.folder_id)
    conn.execute("UPDATE bookmarks SET folder_id=? WHERE id=?", (req.folder_id, bid))

    # Move order row to new folder (goes to bottom)
    move_order_row(conn, req.folder_id, bid, "bookmark")

    conn.commit()
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d

@app.patch("/bookmark/{bid}/tags")
def patch_tags(bid: str, req: BookmarkTagPatch):
    conn = get_db()
    row = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")

    clean_tags = list({t.strip().lower() for t in req.tags if t.strip()})
    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    for tag in clean_tags:
        conn.execute("INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag))
    conn.commit()
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d

@app.patch("/bookmark/{bid}/notes")
def patch_notes(bid: str, req: BookmarkNotesPatch):
    conn = get_db()
    row = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    conn.execute("UPDATE bookmarks SET notes=? WHERE id=?", (req.notes, bid))
    conn.commit()
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d

# ── Bulk operations ───────────────────────────────────────────────────────────

@app.post("/folders/bulk-move")
def bulk_move_folders(req: BulkFolderMoveRequest):
    if not req.ids: raise HTTPException(400, "ids list is empty")
    conn = get_db()

    # 1. Validate the target parent exists
    if req.target_parent_id is not None:
        parent = conn.execute("SELECT id FROM folders WHERE id=?", (req.target_parent_id,)).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(404, f"Target parent folder '{req.target_parent_id}' not found")

    # 2. Safety Check: Prevent moving any folder into itself or its own descendants
    for fid in req.ids:
        descendants = descendant_folder_ids(conn, fid)
        if req.target_parent_id in descendants:
            conn.close()
            raise HTTPException(400, "Cannot move a folder into itself or one of its descendants")

    # 3. Find the valid folders
    placeholders = ",".join("?" * len(req.ids))
    existing = conn.execute(f"SELECT id FROM folders WHERE id IN ({placeholders})", req.ids).fetchall()
    found_ids = [r["id"] for r in existing]

    # 4. Update the DB
    if found_ids:
        conn.execute(f"UPDATE folders SET parent_id=? WHERE id IN ({placeholders})", [req.target_parent_id] + found_ids)
        
        # Move order rows so they appear at the bottom of the new parent folder
        for fid in found_ids:
            move_order_row(conn, req.target_parent_id, fid, "folder")

    conn.commit()
    conn.close()
    return {"status": "moved", "count": len(found_ids), "parent_id": req.target_parent_id}


@app.post("/bookmarks/bulk-move")
def bulk_move(req: BulkMoveRequest):
    if not req.ids: raise HTTPException(400, "ids list is empty")
    conn = get_db()
    _validate_folder(conn, req.folder_id)
    placeholders = ",".join("?" * len(req.ids))
    existing = conn.execute(f"SELECT id FROM bookmarks WHERE id IN ({placeholders})", req.ids).fetchall()
    found_ids = [r["id"] for r in existing]
    conn.execute(f"UPDATE bookmarks SET folder_id=? WHERE id IN ({placeholders})", [req.folder_id] + found_ids)

    # Move order rows for all bookmarks (each goes to bottom of target folder)
    for bid in found_ids:
        move_order_row(conn, req.folder_id, bid, "bookmark")

    conn.commit()
    conn.close()
    return {"status": "moved", "count": len(found_ids), "folder_id": req.folder_id}

@app.post("/bookmarks/bulk-copy")
def bulk_copy(req: BulkCopyRequest):
    print("copy was called")
    if not req.ids: raise HTTPException(400, "ids list is empty")
    conn = get_db()
    _validate_folder(conn, req.folder_id)
    placeholders = ",".join("?" * len(req.ids))
    rows = conn.execute(f"SELECT * FROM bookmarks WHERE id IN ({placeholders})", req.ids).fetchall()
    now = datetime.utcnow().isoformat()
    new_ids = []

    for row in rows:
        d = row_to_dict(row)
        original_tags = get_tags(conn, d["id"])
        target_vault = req.vault or d["vault"]
        seed = f"{d['url']}|{req.folder_id}|{target_vault}|{now}|{d['id']}"
        new_bid = make_id(seed)
        new_norm = d["url_normalized"] + f"#copy-{new_bid}"

        # --- PHYSICAL FILE COPY LOGIC ---
        # 1. Handle Screenshot File
        new_screenshot_path = None
        if d.get("screenshot_path"):
            old_p = Path(d["screenshot_path"])
            if old_p.exists():
                new_p = old_p.with_name(f"{new_bid}{old_p.suffix}")
                shutil.copy2(old_p, new_p)
                new_screenshot_path = str(new_p)

        # 2. Handle Offline HTML Cache File
        new_html_path = None
        if d.get("html_path"):
            old_p = Path(d["html_path"])
            if old_p.exists():
                new_p = old_p.with_name(f"{new_bid}{old_p.suffix}")
                shutil.copy2(old_p, new_p)
                new_html_path = str(new_p)

        # 3. Handle Favicon File
        new_favicon_path = None
        if d.get("favicon_path"):
            old_p = Path(d["favicon_path"])
            if old_p.exists():
                new_p = old_p.with_name(f"{new_bid}{old_p.suffix}")
                shutil.copy2(old_p, new_p)
                new_favicon_path = str(new_p)

        # Insert into database using the freshly generated unique asset paths
        conn.execute("""
            INSERT OR IGNORE INTO bookmarks
                (id, url, url_normalized, title, vault, created_at,
                 archived, screenshot, html_path, screenshot_path, notes, folder_id, favicon_url, favicon_path)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            new_bid, 
            d["url"], 
            new_norm, 
            d["title"],
            target_vault, 
            now, 
            d.get("archived", 0),
            d.get("screenshot", 0),
            new_html_path,          # Points to the brand new cloned HTML file
            new_screenshot_path,    # Points to the brand new cloned image file
            d["notes"], 
            req.folder_id,
            d.get("favicon_url", ""), 
            new_favicon_path        # Points to the brand new cloned favicon file
        ))

        for tag in original_tags:
            conn.execute("INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (new_bid, tag))

        ensure_order_row(conn, req.folder_id, new_bid, "bookmark")
        new_ids.append(new_bid)

    conn.commit()
    placeholders2 = ",".join("?" * len(new_ids))
    new_rows = conn.execute(f"SELECT * FROM bookmarks WHERE id IN ({placeholders2})", new_ids).fetchall() if new_ids else []
    results = [enrich_bookmark(conn, r) for r in new_rows]
    conn.close()
    return {"status": "copied", "count": len(results), "bookmarks": results}



@app.post("/bookmarks/bulk-tag")
def bulk_tag(req: BulkTagRequest):
    if not req.ids: raise HTTPException(400, "ids list is empty")
    add_tags    = [t.strip().lower() for t in req.add    if t.strip()]
    remove_tags = [t.strip().lower() for t in req.remove if t.strip()]
    conn = get_db()
    placeholders = ",".join("?" * len(req.ids))
    existing = conn.execute(f"SELECT id FROM bookmarks WHERE id IN ({placeholders})", req.ids).fetchall()
    found_ids = [r["id"] for r in existing]

    for bid in found_ids:
        for tag in add_tags:
            conn.execute("INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag))
        for tag in remove_tags:
            conn.execute("DELETE FROM tags WHERE bookmark_id=? AND tag=?", (bid, tag))

    conn.commit()
    conn.close()
    return {"status": "ok", "updated": len(found_ids), "added": add_tags, "removed": remove_tags}

# ── Playwright Fetching & Archiving Endpoints ─────────────────────────────────

@app.post("/bookmarks/bulk-fetch")
async def bulk_fetch_archives(req: BulkFetchRequest):
    if not req.ids:
        raise HTTPException(400, "No bookmark IDs provided")

    conn = get_db()
    placeholders = ",".join("?" * len(req.ids))
    rows = conn.execute(f"SELECT * FROM bookmarks WHERE id IN ({placeholders})", req.ids).fetchall()
    conn.close()

    if not rows:
        raise HTTPException(404, "None of the requested bookmarks were found")

    successful_ids = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})

        for row in rows:
            bid = row["id"]
            url = row["url"]
            current_html = row["html_path"]
            current_favicon = row["favicon_path"]
            is_archived = row["archived"]

            page = await context.new_page()

            try:
                await page.goto(url, timeout=20000, wait_until="networkidle")

                ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
                await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)

                fav_path = current_favicon
                try:
                    fav_url = await page.evaluate(JS_GET_FAVICON)
                    if fav_url:
                        fav_res = await page.request.get(fav_url, timeout=5000)
                        if fav_res.ok:
                            fav_disk_path = FAVICON_DIR / f"{bid}.ico"
                            fav_disk_path.write_bytes(await fav_res.body())
                            fav_path = str(fav_disk_path)
                except Exception as e:
                    print(f"Failed to fetch favicon for {url}: {e}")

                await page.close()

                html_path = current_html
                if req.archive:
                    target_path = str(ARCHIVE_DIR / f"{bid}.html")
                    cmd = [
                        "single-file",
                        url,
                        target_path,
                        "--browser-executable-path", "/usr/bin/chromium"
                    ]
                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, stderr = await proc.communicate()

                    if proc.returncode == 0:
                        html_path = target_path
                        is_archived = 1
                    else:
                        print(f"single-file failed for {url}: {stderr.decode('utf-8')}")

                db = get_db()
                db.execute("""
                    UPDATE bookmarks
                    SET screenshot=1, screenshot_path=?, archived=?, html_path=?, favicon_path=?
                    WHERE id=?
                """, (ss_path, is_archived, html_path, fav_path, bid))
                db.commit()
                db.close()

                successful_ids.append(bid)
            except Exception as e:
                print(f"Failed to bulk-fetch {url}: {e}")
                if not page.is_closed():
                    await page.close()
            finally:
                if not page.is_closed():
                    await page.close()

        await browser.close()

    return {
        "status": "completed",
        "total_requested": len(req.ids),
        "successful_count": len(successful_ids),
        "successful_ids": successful_ids
    }

@app.post("/fetch-meta")
async def fetch_meta(req: FetchMetaRequest):
    norm = normalize_url(req.url)
    bid = make_id(norm)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        try:
            await page.goto(req.url, timeout=20000, wait_until="networkidle")
            title = await page.title()

            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)
            screenshot_bytes = Path(ss_path).read_bytes()
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")

            try:
                fav_url = await page.evaluate(JS_GET_FAVICON)
                if fav_url:
                    fav_res = await page.request.get(fav_url, timeout=5000)
                    if fav_res.ok:
                        Path(FAVICON_DIR / f"{bid}.ico").write_bytes(await fav_res.body())
            except Exception as e:
                print(f"Failed to fetch favicon for {req.url}: {e}")

            await page.close()

            if req.archive:
                html_path = str(ARCHIVE_DIR / f"{bid}.html")
                cmd = [
                    "single-file",
                    req.url,
                    html_path,
                    "--browser-executable-path", "/usr/bin/chromium"
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()

            return {
                "title": title,
                "screenshot": f"data:image/jpeg;base64,{screenshot_b64}"
            }
        except Exception as e:
            raise HTTPException(500, f"Failed to fetch metadata: {str(e)}")
        finally:
            if not browser.is_connected():
                await browser.close()

@app.post("/bookmark/{bid}/fetch")
async def fetch_bookmark_archive(bid: str, req: BookmarkFetchRequest):
    conn = get_db()
    row = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")

    url = row["url"]
    current_html = row["html_path"]
    current_favicon = row["favicon_path"]
    is_archived = row["archived"]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()

        try:
            await page.goto(url, timeout=20000, wait_until="networkidle")

            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)

            fav_path = current_favicon
            try:
                fav_url = await page.evaluate(JS_GET_FAVICON)
                if fav_url:
                    fav_res = await page.request.get(fav_url, timeout=5000)
                    if fav_res.ok:
                        fav_disk_path = FAVICON_DIR / f"{bid}.ico"
                        fav_disk_path.write_bytes(await fav_res.body())
                        fav_path = str(fav_disk_path)
            except Exception as e:
                print(f"Failed to fetch favicon for {url}: {e}")

            await page.close()

            html_path = current_html
            if req.archive:
                target_path = str(ARCHIVE_DIR / f"{bid}.html")
                cmd = [
                    "single-file",
                    url,
                    target_path,
                    "--browser-executable-path", "/usr/bin/chromium"
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode == 0:
                    html_path = target_path
                    is_archived = 1
                else:
                    raise Exception(f"single-file CLI failed: {stderr.decode('utf-8')}")

            conn.execute("""
                UPDATE bookmarks
                SET screenshot=1, screenshot_path=?, archived=?, html_path=?, favicon_path=?
                WHERE id=?
            """, (ss_path, is_archived, html_path, fav_path, bid))
            conn.commit()

        except Exception as e:
            conn.close()
            raise HTTPException(500, f"Failed to fetch page: {str(e)}")
        finally:
            if not browser.is_connected():
                await browser.close()

    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d

@app.get("/lookup")
def lookup(url: str = Query(...)):
    norm = normalize_url(url)
    conn = get_db()
    row  = conn.execute("SELECT * FROM bookmarks WHERE url_normalized=?", (norm,)).fetchone()
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

@app.post("/save")
def save(req: SaveRequest):
    norm = normalize_url(req.url)
    bid  = make_id(norm)
    conn = get_db()

    if req.folder_id:
        _validate_folder(conn, req.folder_id)

    existing = conn.execute("SELECT id, folder_id FROM bookmarks WHERE url_normalized=?", (norm,)).fetchone()

    ss_path = html_path = fav_path = None

    if req.screenshot_data:
        try:
            raw = base64.b64decode(req.screenshot_data.split(",")[-1])
            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            Path(ss_path).write_bytes(raw)
        except Exception as e:
            print(f"Screenshot save failed: {e}")
    else:
        potential_ss = ARCHIVE_DIR / f"{bid}.jpeg"
        if potential_ss.exists():
            ss_path = str(potential_ss)

    if req.archive:
        if req.html_data:
            try:
                raw = base64.b64decode(req.html_data)
                html_path = str(ARCHIVE_DIR / f"{bid}.html")
                Path(html_path).write_bytes(raw)
            except Exception as e:
                print(f"HTML archive save failed: {e}")
        else:
            potential_html = ARCHIVE_DIR / f"{bid}.html"
            if potential_html.exists():
                html_path = str(potential_html)

    potential_fav = FAVICON_DIR / f"{bid}.ico"
    if potential_fav.exists():
        fav_path = str(potential_fav)
    elif req.favicon_url:
        if req.favicon_url.startswith("data:image"):
            try:
                header, encoded = req.favicon_url.split(",", 1)
                potential_fav.write_bytes(base64.b64decode(encoded))
                fav_path = str(potential_fav)
            except Exception as e:
                print(f"Failed to save base64 favicon: {e}")
        elif req.favicon_url.startswith("http"):
            try:
                r = urllib.request.Request(req.favicon_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(r, timeout=5) as response:
                    potential_fav.write_bytes(response.read())
                    fav_path = str(potential_fav)
            except Exception as e:
                print(f"Failed to download favicon: {e}")

    now = datetime.utcnow().isoformat()
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
        # If folder changed, update order row
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
        # New bookmark goes to bottom of its folder
        ensure_order_row(conn, req.folder_id, bid, "bookmark")
        action = "saved"

    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    for tag in set(req.tags):
        tag = tag.strip().lower()
        if tag:
            conn.execute("INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag))

    conn.commit()
    conn.close()
    return {"id": bid, "status": action}

@app.get("/bookmark/{bid}")
def get_bookmark(bid: str):
    conn = get_db()
    row  = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        raise HTTPException(404, "Bookmark not found")
    d = enrich_bookmark(conn, row)
    conn.close()
    return d

@app.delete("/bookmark/{bid}")
def delete_bookmark(bid: str):
    conn = get_db()
    
    # Use row_factory or access by column name depending on your setup.
    # Assuming row can be accessed like a dictionary or by string keys.
    row = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()  # Prevent database connection leak on 404
        raise HTTPException(404, "Bookmark not found")
        
    # Convert row to dict if you are using standard sqlite3 rows without row_factory
    # d = dict(row) or just use row["column"] if row_factory is set to sqlite3.Row
    d = dict(row) if not isinstance(row, dict) else row

    for col in ("screenshot_path", "html_path", "favicon_path"):
        p = d.get(col)
        if p:
            # SAFETY CHECK: Count how many OTHER bookmarks are using this exact file
            shared_count = conn.execute(
                f"SELECT COUNT(*) FROM bookmarks WHERE {col} = ? AND id != ?", 
                (p, bid)
            ).fetchone()[0]
            
            # Only delete the physical file if no one else is using it!
            if shared_count == 0 and Path(p).exists():
                Path(p).unlink()

    # Clean up relational data
    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    conn.execute("DELETE FROM item_order WHERE item_id=? AND item_type='bookmark'", (bid,))
    conn.execute("DELETE FROM bookmarks WHERE id=?", (bid,))
    
    conn.commit()
    conn.close()
    return {"status": "deleted"}
    

@app.post("/items/bulk-delete")
def bulk_delete(req: BulkDeleteRequest):
    conn = get_db()
    
    # 1. Clean up Bookmarks & physical drive files safely
    if req.bookmark_ids:
        placeholders = ",".join("?" * len(req.bookmark_ids))
        
        # Grab the paths BEFORE deleting the rows
        rows = conn.execute(
            f"SELECT screenshot_path, html_path, favicon_path FROM bookmarks WHERE id IN ({placeholders})", 
            req.bookmark_ids
        ).fetchall()
        
        # Delete from DB first
        conn.execute(f"DELETE FROM tags WHERE bookmark_id IN ({placeholders})", req.bookmark_ids)
        conn.execute(f"DELETE FROM item_order WHERE item_id IN ({placeholders}) AND item_type='bookmark'", req.bookmark_ids)
        conn.execute(f"DELETE FROM bookmarks WHERE id IN ({placeholders})", req.bookmark_ids)

        # Now safely delete physical files ONLY if no remaining bookmarks reference them
        for row in rows:
            for col, path_str in zip(["screenshot_path", "html_path", "favicon_path"], row):
                if path_str:
                    in_use = conn.execute(f"SELECT 1 FROM bookmarks WHERE {col} = ?", (path_str,)).fetchone()
                    if not in_use and Path(path_str).exists():
                        Path(path_str).unlink()

    # 2. Clean up Folders & fix nested items
    if req.folder_ids:
        placeholders = ",".join("?" * len(req.folder_ids))
        conn.execute(f"DELETE FROM item_order WHERE folder_id IN ({placeholders})", req.folder_ids)
        conn.execute(f"DELETE FROM item_order WHERE item_id IN ({placeholders}) AND item_type='folder'", req.folder_ids)
        conn.execute(f"DELETE FROM folders WHERE id IN ({placeholders})", req.folder_ids)
        
        # Keep child contents visible by setting parent context references to root
        conn.execute(f"UPDATE bookmarks SET folder_id = NULL WHERE folder_id IN ({placeholders})", req.folder_ids)
        conn.execute(f"UPDATE folders SET parent_id = NULL WHERE parent_id IN ({placeholders})", req.folder_ids)

    conn.commit()
    conn.close()
    return {"status": "deleted"}

@app.get("/search")
def search(
    q: str = Query(...),
    vault: Optional[str] = None,
    folder_id: Optional[str] = Query(default=None),
    limit: int = 50,
):
    conn = get_db()

    safe_q = q.replace('"', '""')
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

@app.get("/vault/{vault_name}")
def list_vault(vault_name: str, limit: int = 100, offset: int = 0):
    conn  = get_db()
    rows  = conn.execute(
        "SELECT * FROM bookmarks WHERE vault=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (vault_name, limit, offset),
    ).fetchall()
    results = [enrich_bookmark(conn, r) for r in rows]
    total   = conn.execute("SELECT COUNT(*) FROM bookmarks WHERE vault=?", (vault_name,)).fetchone()[0]
    conn.close()
    return {"vault": vault_name, "bookmarks": results, "total": total}

@app.get("/vaults")
def list_vaults():
    conn = get_db()
    rows = conn.execute("SELECT vault, COUNT(*) as count FROM bookmarks GROUP BY vault ORDER BY vault").fetchall()
    conn.close()
    return {"vaults": [{"name": r["vault"], "count": r["count"]} for r in rows]}

@app.get("/recent")
def recent(limit: int = 20):
    conn = get_db()
    rows = conn.execute("SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    results = [enrich_bookmark(conn, r) for r in rows]
    conn.close()
    return {"bookmarks": results}