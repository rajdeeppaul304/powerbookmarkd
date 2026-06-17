"""
database.py - DB connection, schema initialization, and live migrations
"""

import sqlite3
from pathlib import Path

BASE_DIR    = Path(__file__).parent.parent / "data"
DB_PATH     = BASE_DIR / "bookmarks.db"
ARCHIVE_DIR = BASE_DIR / "archive"
FAVICON_DIR = BASE_DIR / "favicons"

# TRASH_DIR = BASE_DIR / "trash"
# TRASH_DIR.mkdir(parents=True, exist_ok=True)


BASE_DIR.mkdir(parents=True, exist_ok=True)
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
FAVICON_DIR.mkdir(parents=True, exist_ok=True)


def get_db() -> sqlite3.Connection:
    # 1. Increase timeout from 5s to 20s so it waits patiently during heavy traffic
    conn = sqlite3.connect(DB_PATH, timeout=20.0) 
    conn.row_factory = sqlite3.Row
    
    # 2. Enable Write-Ahead Logging (Crucial for concurrent apps!)
    conn.execute("PRAGMA journal_mode = WAL")
    
    # 3. Optimize sync mode for WAL (Much faster disk writes)
    conn.execute("PRAGMA synchronous = NORMAL")
    
    # 4. Keep foreign keys enforced
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

        CREATE TABLE IF NOT EXISTS vaults (
            name TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS deleted_items (
            id            TEXT PRIMARY KEY,
            deleted_at    TEXT NOT NULL,
            data          TEXT NOT NULL
        );
    """)

    # ── Live migrations: add columns if absent ────────────────────────────────
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

    # ── Ensure default vault and migrate existing vault names ─────────────────
    c.execute("INSERT OR IGNORE INTO vaults (name) VALUES ('default')")
    c.execute("INSERT OR IGNORE INTO vaults (name) SELECT DISTINCT vault FROM bookmarks")
    c.execute("INSERT OR IGNORE INTO vaults (name) SELECT DISTINCT vault FROM folders")


    

    conn.commit()
    conn.close()