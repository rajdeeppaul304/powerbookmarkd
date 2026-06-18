"""
routers/vaults.py - Vault listing, creation, renaming, and deletion
"""

from fastapi import APIRouter, HTTPException, Query

from database import get_db
from state import broadcast_sync
from models import VaultSetPin, VaultUnlockRequest
import bcrypt
import secrets
from datetime import datetime

router = APIRouter()


@router.get("/vaults")
def list_vaults():
    conn = get_db()
    rows = conn.execute("""
        SELECT v.name AS vault, v.pin_hash, v.is_locked, COUNT(b.id) AS count
        FROM vaults v
        LEFT JOIN bookmarks b ON v.name = b.vault
        GROUP BY v.name
        ORDER BY v.name
    """).fetchall()
    conn.close()
    return {"vaults": [{"name": r["vault"], "count": r["count"], "is_locked": bool(r["is_locked"]), "has_pin": bool(r["pin_hash"])} for r in rows]}



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


# In-memory token store: { token: vault_name }
_vault_tokens: dict[str, str] = {}

@router.post("/vaults/{vault_name}/set-pin")
def set_vault_pin(vault_name: str, req: VaultSetPin):
    conn = get_db()
    row = conn.execute("SELECT name FROM vaults WHERE name=?", (vault_name,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Vault not found")
    
    if req.pin is None:
        # Remove PIN (unlock vault permanently)
        conn.execute("UPDATE vaults SET pin_hash=NULL, is_locked=0 WHERE name=?", (vault_name,))
    else:
        pin_hash = bcrypt.hashpw(req.pin.encode(), bcrypt.gensalt()).decode()
        conn.execute("UPDATE vaults SET pin_hash=?, is_locked=1 WHERE name=?", (pin_hash, vault_name))
    
    conn.commit()
    conn.close()
    broadcast_sync({"type": "vaults_changed"})
    return {"status": "ok"}


@router.post("/vaults/{vault_name}/unlock")
def unlock_vault(vault_name: str, req: VaultUnlockRequest):
    conn = get_db()
    row = conn.execute("SELECT pin_hash FROM vaults WHERE name=?", (vault_name,)).fetchone()
    conn.close()
    if not row or not row["pin_hash"]:
        raise HTTPException(400, "Vault has no PIN set")
    
    if not bcrypt.checkpw(req.pin.encode(), row["pin_hash"].encode()):
        raise HTTPException(401, "Incorrect PIN")
    
    token = secrets.token_hex(32)
    _vault_tokens[token] = vault_name
    return {"token": token}


@router.post("/vaults/{vault_name}/lock")
def lock_vault(vault_name: str):
    # Invalidate all tokens for this vault
    to_delete = [t for t, v in _vault_tokens.items() if v == vault_name]
    for t in to_delete:
        del _vault_tokens[t]
    return {"status": "locked"}


@router.post("/vaults/lock-all")
def lock_all_vaults():
    _vault_tokens.clear()
    return {"status": "all_locked"}
