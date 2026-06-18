"""
routers/vaults.py - Vault listing, creation, renaming, and deletion
"""

from fastapi import APIRouter, HTTPException, Query

from database import get_db
from state import broadcast_sync

router = APIRouter()


@router.get("/vaults")
def list_vaults():
    conn = get_db()
    rows = conn.execute("""
        SELECT v.name AS vault, COUNT(b.id) AS count
        FROM vaults v
        LEFT JOIN bookmarks b ON v.name = b.vault
        GROUP BY v.name
        ORDER BY v.name
    """).fetchall()
    conn.close()
    return {"vaults": [{"name": r["vault"], "count": r["count"]} for r in rows]}


@router.post("/vaults")
def create_vault(name: str = Query(...)):
    conn = get_db()
    conn.execute("INSERT OR IGNORE INTO vaults (name) VALUES (?)", (name.strip(),))
    conn.commit()
    broadcast_sync({"type": "vaults_changed"})
    conn.close()
    return {"status": "created", "vault": name.strip()}


@router.post("/vaults/rename")
def rename_vault(old_name: str = Query(...), new_name: str = Query(...)):
    conn = get_db()
    conn.execute("UPDATE vaults SET name=? WHERE name=?", (new_name, old_name))
    conn.execute("UPDATE bookmarks SET vault=? WHERE vault=?", (new_name, old_name))
    conn.execute("UPDATE folders SET vault=? WHERE vault=?", (new_name, old_name))
    conn.commit()
    broadcast_sync({"type": "vaults_changed"})
    broadcast_sync({"type": "bookmarks_changed"})
    broadcast_sync({"type": "folders_changed"})
    conn.close()
    return {"status": "renamed", "from": old_name, "to": new_name}


@router.delete("/vaults/{vault_name}")
def delete_vault(vault_name: str):
    if vault_name == "default":
        raise HTTPException(400, "Cannot delete default vault")
    conn = get_db()
    conn.execute("DELETE FROM vaults WHERE name=?", (vault_name,))
    conn.execute("DELETE FROM bookmarks WHERE vault=?", (vault_name,))
    conn.execute("DELETE FROM folders WHERE vault=?", (vault_name,))
    conn.commit()
    broadcast_sync({"type": "vaults_changed"})
    broadcast_sync({"type": "bookmarks_changed"})
    broadcast_sync({"type": "folders_changed"})
    conn.close()
    return {"status": "deleted"}


@router.get("/vault/{vault_name}")
def list_vault(vault_name: str, limit: int = 100, offset: int = 0):
    conn    = get_db()
    rows    = conn.execute(
        "SELECT * FROM bookmarks WHERE vault=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (vault_name, limit, offset),
    ).fetchall()
    from utils import enrich_bookmark
    results = [enrich_bookmark(conn, r) for r in rows]
    total   = conn.execute(
        "SELECT COUNT(*) FROM bookmarks WHERE vault=?", (vault_name,)
    ).fetchone()[0]
    conn.close()
    return {"vault": vault_name, "bookmarks": results, "total": total}