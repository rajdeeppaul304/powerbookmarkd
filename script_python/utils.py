"""
utils.py - URL normalization, ID generation, and shared DB helpers
"""

import hashlib
import os
import sqlite3
from typing import List, Optional


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


# ── Shared DB read helpers ────────────────────────────────────────────────────

def row_to_dict(row) -> dict:
    return dict(row)


def get_tags(conn: sqlite3.Connection, bookmark_id: str) -> List[str]:
    rows = conn.execute(
        "SELECT tag FROM tags WHERE bookmark_id=?", (bookmark_id,)
    ).fetchall()
    return [r["tag"] for r in rows]


def enrich_bookmark(conn: sqlite3.Connection, row) -> dict:
    d = row_to_dict(row)
    d["tags"]       = get_tags(conn, d["id"])
    d["archived"]   = bool(d["archived"])
    d["screenshot"] = bool(d["screenshot"])
    return d


# def descendant_folder_ids(conn: sqlite3.Connection, folder_id: str) -> set:
#     result = {folder_id}
#     queue  = [folder_id]
#     while queue:
#         current = queue.pop()
#         children = conn.execute(
#             "SELECT id FROM folders WHERE parent_id=?", (current,)
#         ).fetchall()
#         for child in children:
#             cid = child["id"]
#             if cid not in result:
#                 result.add(cid)
#                 queue.append(cid)
#     return result

def descendant_folder_ids(conn: sqlite3.Connection, folder_id: str) -> set:
    rows = conn.execute("""
        WITH RECURSIVE descendants AS (
            -- Base case: start with the selected folder
            SELECT id FROM folders WHERE id = ?
            
            UNION ALL
            
            -- Recursive step: find children of anything in the 'descendants' table
            SELECT f.id FROM folders f
            INNER JOIN descendants d ON f.parent_id = d.id
        )
        SELECT id FROM descendants;
    """, (folder_id,)).fetchall()
    
    return {r["id"] for r in rows}