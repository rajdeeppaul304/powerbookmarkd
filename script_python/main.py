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
from pathlib import Path
from datetime import datetime
from typing import Optional, List
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio

from playwright.async_api import async_playwright

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent / "data"
DB_PATH     = BASE_DIR / "bookmarks.db"
ARCHIVE_DIR = BASE_DIR / "archive"

BASE_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="powerbookmarkd", version="1.2.2")
app.mount("/static/archive", StaticFiles(directory=str(ARCHIVE_DIR)), name="archive")

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

        -- Folders table (v1.1)
        CREATE TABLE IF NOT EXISTS folders (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            parent_id TEXT,
            vault     TEXT DEFAULT 'default',
            FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE CASCADE
        );
    """)

    # Live migrations: add columns if absent
    existing_cols = {
        row[1]
        for row in c.execute("PRAGMA table_info(bookmarks)").fetchall()
    }
    if "folder_id" not in existing_cols:
        c.execute("""
            ALTER TABLE bookmarks
            ADD COLUMN folder_id TEXT
            REFERENCES folders(id) ON DELETE SET NULL
        """)
    if "favicon_url" not in existing_cols:
        c.execute("ALTER TABLE bookmarks ADD COLUMN favicon_url TEXT DEFAULT ''")

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
    parent_id: Optional[str] = None   # None = move to root


class BookmarkMove(BaseModel):
    folder_id: Optional[str] = None


# ── v1.2 bulk + tag-edit models ───────────────────────────────────────────────
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


# -- added by me
# Add this anywhere inside the Models section
class FetchMetaRequest(BaseModel):
    url: str
    archive: bool = False # Added this flag

class BookmarkFetchRequest(BaseModel):
    archive: bool = False

class BulkFetchRequest(BaseModel):
    ids: List[str]
    archive: bool = False

# ── Helpers ───────────────────────────────────────────────────────────────────
def row_to_dict(row) -> dict:
    return dict(row)


def get_tags(conn, bookmark_id: str) -> List[str]:
    rows = conn.execute(
        "SELECT tag FROM tags WHERE bookmark_id=?", (bookmark_id,)
    ).fetchall()
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
    """Return subfolder_count and bookmark_count for a folder."""
    if folder_id:
        sf_count = conn.execute(
            "SELECT COUNT(*) FROM folders WHERE parent_id=? AND vault=?",
            (folder_id, vault)
        ).fetchone()[0]
        bm_count = conn.execute(
            "SELECT COUNT(*) FROM bookmarks WHERE folder_id=? AND vault=?",
            (folder_id, vault)
        ).fetchone()[0]
    else:
        sf_count = conn.execute(
            "SELECT COUNT(*) FROM folders WHERE parent_id IS NULL AND vault=?",
            (vault,)
        ).fetchone()[0]
        bm_count = conn.execute(
            "SELECT COUNT(*) FROM bookmarks WHERE folder_id IS NULL AND vault=?",
            (vault,)
        ).fetchone()[0]
    return {"subfolder_count": sf_count, "bookmark_count": bm_count}


def descendant_folder_ids(conn, folder_id: str) -> set:
    """
    Returns the set of all descendant folder ids (including folder_id itself).
    Uses iterative BFS to avoid recursion limits.
    """
    result = {folder_id}
    queue  = [folder_id]
    while queue:
        current = queue.pop()
        children = conn.execute(
            "SELECT id FROM folders WHERE parent_id=?", (current,)
        ).fetchall()
        for child in children:
            cid = child["id"]
            if cid not in result:
                result.add(cid)
                queue.append(cid)
    return result


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "powerbookmarkd", "version": "1.2.2"}


# ── Folder endpoints ──────────────────────────────────────────────────────────

@app.post("/folders", status_code=201)
def create_folder(req: FolderCreate):
    conn = get_db()
    if req.parent_id:
        parent = conn.execute(
            "SELECT id FROM folders WHERE id=?", (req.parent_id,)
        ).fetchone()
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

    conn.execute(
        "INSERT INTO folders (id, name, parent_id, vault) VALUES (?,?,?,?)",
        (fid, req.name.strip(), req.parent_id, req.vault),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@app.patch("/folders/{fid}")
def rename_folder(fid: str, req: FolderRename):
    if not req.name.strip():
        raise HTTPException(400, "Folder name cannot be empty")
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

    # Folder must exist
    row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")

    # Validate target parent exists (if not moving to root)
    if req.parent_id is not None:
        parent = conn.execute(
            "SELECT id FROM folders WHERE id=?", (req.parent_id,)
        ).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(404, f"Target parent folder '{req.parent_id}' not found")

    # Prevent moving a folder into itself or one of its own descendants
    descendants = descendant_folder_ids(conn, fid)
    if req.parent_id in descendants:
        conn.close()
        raise HTTPException(400, "Cannot move a folder into itself or one of its descendants")

    conn.execute("UPDATE folders SET parent_id=? WHERE id=?", (req.parent_id, fid))
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
    conn.execute("DELETE FROM folders WHERE id=?", (fid,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "id": fid}


@app.get("/folders/{fid}/path")
def folder_path(fid: str):
    """
    Returns ancestors (breadcrumb) for a folder id.
    Response: { "breadcrumb": [{id, name}, ...], "ancestors": [{id, name}, ...] }
    ancestors = all nodes ABOVE the folder (not including the folder itself),
    breadcrumb = full chain root → folder (including the folder itself).
    """
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
    chain.reverse()  # now root → folder
    # ancestors = everything except the last item (the folder itself)
    ancestors = chain[:-1]
    return {"breadcrumb": chain, "ancestors": ancestors}


# ── Contents ──────────────────────────────────────────────────────────────────

@app.get("/contents")
def get_contents(
    folder_id: Optional[str] = Query(default=None),
    vault: str = Query(default="default"),
    archived: Optional[bool] = Query(default=None),
):
    conn = get_db()

    # Fetch subfolders
    if folder_id:
        subfolder_rows = conn.execute(
            "SELECT * FROM folders WHERE parent_id=? AND vault=? ORDER BY name",
            (folder_id, vault),
        ).fetchall()
    else:
        subfolder_rows = conn.execute(
            "SELECT * FROM folders WHERE parent_id IS NULL AND vault=? ORDER BY name",
            (vault,),
        ).fetchall()

    # Enrich each subfolder with counts
    subfolders = []
    for r in subfolder_rows:
        d = row_to_dict(r)
        counts = _folder_counts(conn, d["id"], vault)
        d.update(counts)
        subfolders.append(d)

    # Fetch bookmarks in this folder
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
    conn.close()
    return {"current_folder_id": folder_id, "subfolders": subfolders, "bookmarks": bookmarks}


# ── Single bookmark move ──────────────────────────────────────────────────────

@app.patch("/bookmark/{bid}/move")
def move_bookmark(bid: str, req: BookmarkMove):
    conn = get_db()
    row = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    _validate_folder(conn, req.folder_id)
    conn.execute("UPDATE bookmarks SET folder_id=? WHERE id=?", (req.folder_id, bid))
    conn.commit()
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


# ── Single bookmark tag patch ─────────────────────────────────────────────────

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
        conn.execute(
            "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag)
        )
    conn.commit()
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


# ── Single bookmark notes patch ───────────────────────────────────────────────

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


# ── v1.2 Bulk operations ──────────────────────────────────────────────────────

@app.post("/bookmarks/bulk-move")
def bulk_move(req: BulkMoveRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")
    conn = get_db()
    _validate_folder(conn, req.folder_id)

    placeholders = ",".join("?" * len(req.ids))
    existing = conn.execute(
        f"SELECT id FROM bookmarks WHERE id IN ({placeholders})", req.ids
    ).fetchall()
    found_ids = [r["id"] for r in existing]

    conn.execute(
        f"UPDATE bookmarks SET folder_id=? WHERE id IN ({placeholders})",
        [req.folder_id] + found_ids,
    )
    conn.commit()
    conn.close()
    return {"status": "moved", "count": len(found_ids), "folder_id": req.folder_id}


@app.post("/bookmarks/bulk-copy")
def bulk_copy(req: BulkCopyRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")

    conn = get_db()
    _validate_folder(conn, req.folder_id)

    placeholders = ",".join("?" * len(req.ids))
    rows = conn.execute(
        f"SELECT * FROM bookmarks WHERE id IN ({placeholders})", req.ids
    ).fetchall()

    now = datetime.utcnow().isoformat()
    new_ids = []

    for row in rows:
        d = row_to_dict(row)
        original_tags = get_tags(conn, d["id"])
        target_vault = req.vault or d["vault"]

        seed = f"{d['url']}|{req.folder_id}|{target_vault}|{now}|{d['id']}"
        new_bid = make_id(seed)
        new_norm = d["url_normalized"] + f"#copy-{new_bid}"

        conn.execute("""
            INSERT OR IGNORE INTO bookmarks
                (id, url, url_normalized, title, vault, created_at,
                 archived, screenshot, html_path, screenshot_path, notes, folder_id, favicon_url)
            VALUES (?,?,?,?,?,?,0,0,NULL,NULL,?,?,?)
        """, (
            new_bid, d["url"], new_norm, d["title"],
            target_vault, now, d["notes"], req.folder_id,
            d.get("favicon_url", ""),
        ))

        for tag in original_tags:
            conn.execute(
                "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)",
                (new_bid, tag),
            )
        new_ids.append(new_bid)

    conn.commit()

    placeholders2 = ",".join("?" * len(new_ids))
    new_rows = conn.execute(
        f"SELECT * FROM bookmarks WHERE id IN ({placeholders2})", new_ids
    ).fetchall() if new_ids else []
    results = [enrich_bookmark(conn, r) for r in new_rows]
    conn.close()
    return {"status": "copied", "count": len(results), "bookmarks": results}


@app.post("/bookmarks/bulk-tag")
def bulk_tag(req: BulkTagRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")

    add_tags    = [t.strip().lower() for t in req.add    if t.strip()]
    remove_tags = [t.strip().lower() for t in req.remove if t.strip()]

    conn = get_db()
    placeholders = ",".join("?" * len(req.ids))
    existing = conn.execute(
        f"SELECT id FROM bookmarks WHERE id IN ({placeholders})", req.ids
    ).fetchall()
    found_ids = [r["id"] for r in existing]

    for bid in found_ids:
        for tag in add_tags:
            conn.execute(
                "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (bid, tag)
            )
        for tag in remove_tags:
            conn.execute(
                "DELETE FROM tags WHERE bookmark_id=? AND tag=?", (bid, tag)
            )

    conn.commit()
    conn.close()
    return {"status": "ok", "updated": len(found_ids), "added": add_tags, "removed": remove_tags}


# ── Existing endpoints ────────────────────────────────────────────────────────

@app.post("/bookmarks/bulk-fetch")
async def bulk_fetch_archives(req: BulkFetchRequest):
    """
    Sequentially fetches screenshots and optionally HTML archives for a batch of bookmarks.
    """
    if not req.ids:
        raise HTTPException(400, "No bookmark IDs provided")

    conn = get_db()
    placeholders = ",".join("?" * len(req.ids))
    # Fetch all requested bookmarks that actually exist
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
            is_archived = row["archived"]
            
            page = await context.new_page()
            
            try:
                # 1. ALWAYS Save Physical Screenshot via Playwright
                await page.goto(url, timeout=20000, wait_until="networkidle")
                ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
                await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)
                await page.close() # Close playwright page to free RAM for single-file
                
                # 2. OPTIONALLY Save True HTML Archive via single-file-cli
                html_path = current_html
                if req.archive:
                    target_path = str(ARCHIVE_DIR / f"{bid}.html")
                    
                    # Call single-file natively on Arch
                    cmd = [
                        "single-file", 
                        url, 
                        target_path,
                        "--browser-executable-path", "/usr/bin/chromium"
                    ]
                    
                    # Run terminal command asynchronously
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
                
                # 3. Update Database
                db = get_db()
                db.execute("""
                    UPDATE bookmarks 
                    SET screenshot=1, screenshot_path=?, archived=?, html_path=?
                    WHERE id=?
                """, (ss_path, is_archived, html_path, bid))
                db.commit()
                db.close()
                
                successful_ids.append(bid)
            except Exception as e:
                print(f"Failed to bulk-fetch {url}: {e}")
                # Ensure page closes even on failure
                if not page.is_closed():
                    await page.close()
            finally:
                await page.close()
                
        await browser.close()
        
    return {
        "status": "completed", 
        "total_requested": len(req.ids),
        "successful_count": len(successful_ids),
        "successful_ids": successful_ids
    }
# ── Playwright Fetching & Archiving Endpoints ─────────────────────────────────

@app.post("/fetch-meta")
async def fetch_meta(req: FetchMetaRequest):
    """
    Spins up Playwright to grab the title and screenshot.
    If archive=True, runs single-file-cli.
    Saves everything directly to disk using the deterministic Bookmark ID.
    """
    norm = normalize_url(req.url)
    bid = make_id(norm) # Generate the deterministic ID early
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()
        
        try:
            await page.goto(req.url, timeout=20000, wait_until="networkidle")
            title = await page.title()
            
            # Save physical screenshot directly to the archive folder
            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)
            
            # Generate a base64 string strictly for the UI preview
            screenshot_bytes = Path(ss_path).read_bytes()
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            
            await page.close() # Free memory before single-file runs
            
            # If the user ticked the Archive box, run single-file natively
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
            await browser.close()


@app.post("/bookmark/{bid}/fetch")
async def fetch_bookmark_archive(bid: str, req: BookmarkFetchRequest):
    """
    Used to retroactively grab a screenshot and optionally an HTML archive for an existing bookmark.
    """
    conn = get_db()
    row = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")
    
    url = row["url"]
    current_html = row["html_path"]
    is_archived = row["archived"]
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page = await context.new_page()
        
        try:
            # 1. ALWAYS Save Physical Screenshot
            await page.goto(url, timeout=20000, wait_until="networkidle")
            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)
            await page.close() # Close playwright page to free RAM
            
            # 2. OPTIONALLY Save True HTML Archive via single-file-cli
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
            
            # 3. Update Database
            conn.execute("""
                UPDATE bookmarks 
                SET screenshot=1, screenshot_path=?, archived=?, html_path=?
                WHERE id=?
            """, (ss_path, is_archived, html_path, bid))
            conn.commit()
            
        except Exception as e:
            conn.close()
            raise HTTPException(500, f"Failed to fetch page: {str(e)}")
        finally:
            await browser.close()
            
    # Return the updated bookmark data back to the frontend
    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d = enrich_bookmark(conn, updated)
    conn.close()
    return d


@app.get("/lookup")
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


@app.post("/save")
def save(req: SaveRequest):
    norm = normalize_url(req.url)
    bid  = make_id(norm)
    conn = get_db()

    if req.folder_id:
        _validate_folder(conn, req.folder_id)

    existing = conn.execute("SELECT id FROM bookmarks WHERE url_normalized=?", (norm,)).fetchone()

    ss_path = html_path = None

    # --- SCREENSHOT HANDLING ---
    if req.screenshot_data: # (This catches saves from popup.html)
        try:
            raw = base64.b64decode(req.screenshot_data.split(",")[-1])
            ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
            Path(ss_path).write_bytes(raw)
        except Exception as e:
            print(f"Screenshot save failed: {e}")
    else: # (This catches saves from dashboard where /fetch-meta already saved it to disk)
        potential_ss = ARCHIVE_DIR / f"{bid}.jpeg"
        if potential_ss.exists():
            ss_path = str(potential_ss)

    # --- HTML ARCHIVE HANDLING ---
    if req.archive:
        if req.html_data: # (Catches popup.html)
            try:
                raw = base64.b64decode(req.html_data)
                html_path = str(ARCHIVE_DIR / f"{bid}.html")
                Path(html_path).write_bytes(raw)
            except Exception as e:
                print(f"HTML archive save failed: {e}")
        else: # (Catches dashboard where /fetch-meta already saved it)
            potential_html = ARCHIVE_DIR / f"{bid}.html"
            if potential_html.exists():
                html_path = str(potential_html)

    now = datetime.utcnow().isoformat()
    favicon_url = (req.favicon_url or "").strip()

    if existing:
        conn.execute("""
            UPDATE bookmarks SET
                title=?, vault=?, archived=?, screenshot=?,
                html_path=?, screenshot_path=?, notes=?, folder_id=?, favicon_url=?
            WHERE id=?
        """, (
            req.title, req.vault,
            1 if (req.archive and html_path) else 0,
            1 if ss_path else 0,
            html_path, ss_path, req.notes, req.folder_id, favicon_url, bid,
        ))
        action = "updated"
    else:
        conn.execute("""
            INSERT INTO bookmarks
                (id, url, url_normalized, title, vault, created_at,
                 archived, screenshot, html_path, screenshot_path, notes, folder_id, favicon_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            bid, req.url, norm, req.title, req.vault, now,
            1 if (req.archive and html_path) else 0,
            1 if ss_path else 0,
            html_path, ss_path, req.notes, req.folder_id, favicon_url,
        ))
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
    row  = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        raise HTTPException(404, "Bookmark not found")
    for col in ("screenshot_path", "html_path"):
        p = row[col]
        if p and Path(p).exists():
            Path(p).unlink()
    conn.execute("DELETE FROM tags WHERE bookmark_id=?", (bid,))
    conn.execute("DELETE FROM bookmarks WHERE id=?", (bid,))
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
    if vault and folder_id:
        rows = conn.execute("""
            SELECT b.* FROM bookmarks b
            JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
            WHERE bookmarks_fts MATCH ? AND b.vault=? AND b.folder_id=?
            ORDER BY rank LIMIT ?
        """, (q, vault, folder_id, limit)).fetchall()
    elif vault:
        rows = conn.execute("""
            SELECT b.* FROM bookmarks b
            JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
            WHERE bookmarks_fts MATCH ? AND b.vault=?
            ORDER BY rank LIMIT ?
        """, (q, vault, limit)).fetchall()
    else:
        rows = conn.execute("""
            SELECT b.* FROM bookmarks b
            JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
            WHERE bookmarks_fts MATCH ?
            ORDER BY rank LIMIT ?
        """, (q, limit)).fetchall()

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
    total   = conn.execute(
        "SELECT COUNT(*) FROM bookmarks WHERE vault=?", (vault_name,)
    ).fetchone()[0]
    conn.close()
    return {"vault": vault_name, "bookmarks": results, "total": total}


@app.get("/vaults")
def list_vaults():
    conn = get_db()
    rows = conn.execute(
        "SELECT vault, COUNT(*) as count FROM bookmarks GROUP BY vault ORDER BY vault"
    ).fetchall()
    conn.close()
    return {"vaults": [{"name": r["vault"], "count": r["count"]} for r in rows]}


@app.get("/recent")
def recent(limit: int = 20):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    results = [enrich_bookmark(conn, r) for r in rows]
    conn.close()
    return {"bookmarks": results}