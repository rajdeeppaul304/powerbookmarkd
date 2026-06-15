"""
routers/folders.py - Folder CRUD, hierarchy, contents, and item ordering
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from database import get_db
from models import (
    FolderCreate,
    FolderRename,
    FolderMove,
    SetFolderOrderRequest,
)
from ordering import ensure_order_row, move_order_row
from utils import make_folder_id, row_to_dict, enrich_bookmark, descendant_folder_ids

router = APIRouter()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _validate_folder(conn, folder_id: Optional[str]):
    if folder_id is None:
        return
    row = conn.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Folder '{folder_id}' not found")


def _folder_counts(conn, folder_id: Optional[str], vault: str) -> dict:
    if folder_id:
        sf_count = conn.execute(
            "SELECT COUNT(*) FROM folders WHERE parent_id=? AND vault=?", (folder_id, vault)
        ).fetchone()[0]
        bm_count = conn.execute(
            "SELECT COUNT(*) FROM bookmarks WHERE folder_id=? AND vault=?", (folder_id, vault)
        ).fetchone()[0]
    else:
        sf_count = conn.execute(
            "SELECT COUNT(*) FROM folders WHERE parent_id IS NULL AND vault=?", (vault,)
        ).fetchone()[0]
        bm_count = conn.execute(
            "SELECT COUNT(*) FROM bookmarks WHERE folder_id IS NULL AND vault=?", (vault,)
        ).fetchone()[0]
    return {"subfolder_count": sf_count, "bookmark_count": bm_count}


def get_ordered_contents(
    conn,
    folder_id: Optional[str],
    vault: str,
    archived: Optional[bool] = None,
) -> dict:
    """
    Returns subfolders and bookmarks for a folder, sorted by item_order position.
    Items without an order row get position=1e9 (appear at the end).
    """
    # ── Subfolders ────────────────────────────────────────────────────────────
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
        d.update(_folder_counts(conn, d["id"], vault))
        subfolders.append(d)

    # ── Bookmarks ─────────────────────────────────────────────────────────────
    if folder_id:
        base_query = "SELECT * FROM bookmarks WHERE vault=? AND folder_id=?"
        params: tuple = (vault, folder_id)
    else:
        base_query = "SELECT * FROM bookmarks WHERE vault=? AND folder_id IS NULL"
        params = (vault,)

    if archived is not None:
        base_query += " AND archived=?"
        params += (1 if archived else 0,)

    bookmark_rows = conn.execute(base_query, params).fetchall()
    bookmarks     = [enrich_bookmark(conn, r) for r in bookmark_rows]

    # ── Order map ─────────────────────────────────────────────────────────────
    if folder_id is None:
        order_rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order WHERE folder_id IS NULL"
        ).fetchall()
    else:
        order_rows = conn.execute(
            "SELECT item_id, item_type, position FROM item_order WHERE folder_id=?",
            (folder_id,)
        ).fetchall()

    order_map    = {(r["item_id"], r["item_type"]): r["position"] for r in order_rows}
    UNORDERED_POS = 1e9

    for f in subfolders:
        f["position"]  = order_map.get((f["id"], "folder"), UNORDERED_POS)
        f["item_type"] = "folder"

    for b in bookmarks:
        b["position"]  = order_map.get((b["id"], "bookmark"), UNORDERED_POS)
        b["item_type"] = "bookmark"

    all_items = sorted(subfolders + bookmarks, key=lambda x: x["position"])

    return {
        "current_folder_id": folder_id,
        "subfolders":    subfolders,
        "bookmarks":     bookmarks,
        "ordered_items": all_items,
    }


# ── Folder CRUD ───────────────────────────────────────────────────────────────

@router.post("/folders", status_code=201)
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
        fid   = make_folder_id()
        clash = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
        if not clash:
            break
    else:
        conn.close()
        raise HTTPException(500, "Could not generate unique folder id")

    conn.execute(
        "INSERT INTO folders (id, name, parent_id, vault) VALUES (?,?,?,?)",
        (fid, req.name.strip(), req.parent_id, req.vault)
    )
    ensure_order_row(conn, req.parent_id, fid, "folder")
    conn.commit()
    row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(row)


@router.patch("/folders/{fid}")
def rename_folder(fid: str, req: FolderRename):
    if not req.name.strip():
        raise HTTPException(400, "Folder name cannot be empty")
    conn = get_db()
    row  = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")
    conn.execute("UPDATE folders SET name=? WHERE id=?", (req.name.strip(), fid))
    conn.commit()
    updated = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(updated)


@router.post("/folders/{fid}/move")
def move_folder(fid: str, req: FolderMove):
    conn = get_db()
    row  = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")

    if req.parent_id is not None:
        parent = conn.execute(
            "SELECT id FROM folders WHERE id=?", (req.parent_id,)
        ).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(404, f"Target parent folder '{req.parent_id}' not found")

    if req.parent_id in descendant_folder_ids(conn, fid):
        conn.close()
        raise HTTPException(400, "Cannot move a folder into itself or one of its descendants")

    conn.execute("UPDATE folders SET parent_id=? WHERE id=?", (req.parent_id, fid))
    move_order_row(conn, req.parent_id, fid, "folder")
    conn.commit()
    updated = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
    conn.close()
    return row_to_dict(updated)


@router.delete("/folders/{fid}")
def delete_folder(fid: str):
    conn = get_db()
    row  = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Folder not found")
    conn.execute("DELETE FROM item_order WHERE folder_id=?", (fid,))
    conn.execute("DELETE FROM item_order WHERE item_id=? AND item_type='folder'", (fid,))
    conn.execute("DELETE FROM folders WHERE id=?", (fid,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "id": fid}


@router.get("/folders/{fid}/path")
def folder_path(fid: str):
    MAX_DEPTH = 50
    conn = get_db()
    row  = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
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
            current    = row_to_dict(parent_row) if parent_row else None
        else:
            current = None

    conn.close()
    chain.reverse()
    return {"breadcrumb": chain, "ancestors": chain[:-1]}


# ── Contents ──────────────────────────────────────────────────────────────────

@router.get("/contents")
def get_contents(
    folder_id: Optional[str] = Query(default=None),
    vault: str               = Query(default="default"),
    archived: Optional[bool] = Query(default=None),
):
    conn   = get_db()
    result = get_ordered_contents(conn, folder_id, vault, archived)
    conn.close()
    return result


# ── Item ordering ─────────────────────────────────────────────────────────────

@router.post("/folder/order")
def set_folder_order(req: SetFolderOrderRequest):
    conn = get_db()
    if req.folder_id is not None:
        _validate_folder(conn, req.folder_id)

    for item in req.items:
        if item.item_type not in ("bookmark", "folder"):
            conn.close()
            raise HTTPException(400, f"Invalid item_type '{item.item_type}'")

    for i, item in enumerate(req.items):
        pos      = float((i + 1) * 1000.0)
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


@router.get("/folder/{folder_id}/order")
def get_folder_order(folder_id: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT item_id, item_type, position FROM item_order WHERE folder_id=? ORDER BY position",
        (folder_id,)
    ).fetchall()
    conn.close()
    return {"folder_id": folder_id, "items": [dict(r) for r in rows]}


@router.get("/root/order")
def get_root_order():
    conn = get_db()
    rows = conn.execute(
        "SELECT item_id, item_type, position FROM item_order "
        "WHERE folder_id IS NULL ORDER BY position"
    ).fetchall()
    conn.close()
    return {"folder_id": None, "items": [dict(r) for r in rows]}