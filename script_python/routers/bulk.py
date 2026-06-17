"""
routers/bulk.py - Bulk operations: move, copy, tag, delete, and import
"""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

from database import get_db, ARCHIVE_DIR, FAVICON_DIR
from models import (
    BulkMoveRequest,
    BulkCopyRequest,
    BulkTagRequest,
    BulkFolderMoveRequest,
    BulkDeleteRequest,
    BulkImportRequest,
    BulkMoveItemsRequest,
    BulkCopyItemsRequest
)
from ordering import REBALANCE_GAP, ensure_order_row, move_order_row
from state import ACTIVE_JOBS, broadcast_sync
from utils import descendant_folder_ids, enrich_bookmark, get_tags, make_folder_id, make_id, normalize_url, row_to_dict

import shutil
import traceback

router = APIRouter()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _validate_folder(conn, folder_id: Optional[str]):
    if folder_id is None:
        return
    row = conn.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Folder '{folder_id}' not found")


# ── Folder bulk ops ───────────────────────────────────────────────────────────

@router.post("/folders/bulk-move")
def bulk_move_folders(req: BulkFolderMoveRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")
    conn = get_db()

    if req.target_parent_id is not None:
        parent = conn.execute(
            "SELECT id FROM folders WHERE id=?", (req.target_parent_id,)
        ).fetchone()
        if not parent:
            conn.close()
            raise HTTPException(404, f"Target parent folder '{req.target_parent_id}' not found")

    for fid in req.ids:
        if req.target_parent_id in descendant_folder_ids(conn, fid):
            conn.close()
            raise HTTPException(400, "Cannot move a folder into itself or one of its descendants")

    placeholders = ",".join("?" * len(req.ids))
    existing     = conn.execute(
        f"SELECT id FROM folders WHERE id IN ({placeholders})", req.ids
    ).fetchall()
    found_ids = [r["id"] for r in existing]

    if found_ids:
        conn.execute(
            f"UPDATE folders SET parent_id=? WHERE id IN ({placeholders})",
            [req.target_parent_id] + found_ids,
        )
        for fid in found_ids:
            move_order_row(conn, req.target_parent_id, fid, "folder")

    conn.commit()
    broadcast_sync({"type": "folders_changed"})
    conn.close()
    return {"status": "moved", "count": len(found_ids), "parent_id": req.target_parent_id}


# ── Bookmark bulk ops ─────────────────────────────────────────────────────────

@router.post("/bookmarks/bulk-move")
def bulk_move(req: BulkMoveRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")
    conn = get_db()
    _validate_folder(conn, req.folder_id)

    placeholders = ",".join("?" * len(req.ids))
    existing     = conn.execute(
        f"SELECT id FROM bookmarks WHERE id IN ({placeholders})", req.ids
    ).fetchall()
    found_ids = [r["id"] for r in existing]

    conn.execute(
        f"UPDATE bookmarks SET folder_id=? WHERE id IN ({placeholders})",
        [req.folder_id] + found_ids,
    )
    for bid in found_ids:
        move_order_row(conn, req.folder_id, bid, "bookmark")

    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    conn.close()
    return {"status": "moved", "count": len(found_ids), "folder_id": req.folder_id}


@router.post("/bookmarks/bulk-copy")
def bulk_copy(req: BulkCopyRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")
    conn = get_db()
    _validate_folder(conn, req.folder_id)

    placeholders = ",".join("?" * len(req.ids))
    rows         = conn.execute(
        f"SELECT * FROM bookmarks WHERE id IN ({placeholders})", req.ids
    ).fetchall()
    now      = datetime.utcnow().isoformat()
    new_ids  = []

    for row in rows:
        d             = row_to_dict(row)
        original_tags = get_tags(conn, d["id"])
        target_vault  = req.vault or d["vault"]
        seed          = f"{d['url']}|{req.folder_id}|{target_vault}|{now}|{d['id']}"
        new_bid       = make_id(seed)
        new_norm      = d["url_normalized"] + f"#copy-{new_bid}"

        def _copy_file(old_path_str):
            if not old_path_str:
                return None
            old_p = Path(old_path_str)
            if not old_p.exists():
                return None
            new_p = old_p.with_name(f"{new_bid}{old_p.suffix}")
            shutil.copy2(old_p, new_p)
            return str(new_p)

        new_screenshot_path = _copy_file(d.get("screenshot_path"))
        new_html_path       = _copy_file(d.get("html_path"))
        new_favicon_path    = _copy_file(d.get("favicon_path"))

        conn.execute("""
            INSERT OR IGNORE INTO bookmarks
                (id, url, url_normalized, title, vault, created_at,
                 archived, screenshot, html_path, screenshot_path, notes, folder_id, favicon_url, favicon_path)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            new_bid, d["url"], new_norm, d["title"],
            target_vault, now,
            d.get("archived", 0), d.get("screenshot", 0),
            new_html_path, new_screenshot_path,
            d["notes"], req.folder_id,
            d.get("favicon_url", ""), new_favicon_path,
        ))

        for tag in original_tags:
            conn.execute(
                "INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (new_bid, tag)
            )

        ensure_order_row(conn, req.folder_id, new_bid, "bookmark")
        new_ids.append(new_bid)

    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    placeholders2 = ",".join("?" * len(new_ids))
    new_rows = (
        conn.execute(
            f"SELECT * FROM bookmarks WHERE id IN ({placeholders2})", new_ids
        ).fetchall()
        if new_ids else []
    )
    results = [enrich_bookmark(conn, r) for r in new_rows]
    conn.close()
    return {"status": "copied", "count": len(results), "bookmarks": results}


@router.post("/bookmarks/bulk-tag")
def bulk_tag(req: BulkTagRequest):
    if not req.ids:
        raise HTTPException(400, "ids list is empty")
    add_tags    = [t.strip().lower() for t in req.add    if t.strip()]
    remove_tags = [t.strip().lower() for t in req.remove if t.strip()]

    conn         = get_db()
    placeholders = ",".join("?" * len(req.ids))
    existing     = conn.execute(
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
    broadcast_sync({"type": "bookmarks_changed"})
    conn.close()
    return {"status": "ok", "updated": len(found_ids), "added": add_tags, "removed": remove_tags}


# ── Bulk delete ───────────────────────────────────────────────────────────────

@router.post("/items/bulk-delete")
def bulk_delete(req: BulkDeleteRequest):
    conn = get_db()

    all_folder_ids = set(req.folder_ids)
    for fid in req.folder_ids:
        all_folder_ids.update(descendant_folder_ids(conn, fid))

    all_bookmark_ids = set(req.bookmark_ids)
    if all_folder_ids:
        f_placeholders = ",".join("?" * len(all_folder_ids))
        b_rows = conn.execute(
            f"SELECT id FROM bookmarks WHERE folder_id IN ({f_placeholders})",
            list(all_folder_ids)
        ).fetchall()
        all_bookmark_ids.update(r["id"] for r in b_rows)

    folders_snapshot = []
    for fid in all_folder_ids:
        row = conn.execute("SELECT * FROM folders WHERE id=?", (fid,)).fetchone()
        if row:
            d = dict(row)
            depth = 0
            parent = d.get("parent_id")
            while parent:
                depth += 1
                p_row = conn.execute(
                    "SELECT parent_id FROM folders WHERE id=?", (parent,)
                ).fetchone()
                parent = p_row["parent_id"] if p_row else None
            d["depth"] = depth
            folders_snapshot.append(d)

    bookmarks_snapshot = []
    if all_bookmark_ids:
        b_list = list(all_bookmark_ids)
        b_placeholders = ",".join("?" * len(b_list))
        rows = conn.execute(
            f"SELECT * FROM bookmarks WHERE id IN ({b_placeholders})", b_list
        ).fetchall()
        for row in rows:
            d = dict(row)
            tags = conn.execute(
                "SELECT tag FROM tags WHERE bookmark_id=?", (d["id"],)
            ).fetchall()
            d["tags"] = [t["tag"] for t in tags]
            bookmarks_snapshot.append(d)

    now = datetime.utcnow().isoformat()
    import json
    trash_id = uuid.uuid4().hex[:8]
    conn.execute(
        "INSERT INTO deleted_items (id, deleted_at, data) VALUES (?,?,?)",
        (trash_id, now, json.dumps({
            "folders": folders_snapshot,
            "bookmarks": bookmarks_snapshot
        }))
    )

    if all_bookmark_ids:
        b_list = list(all_bookmark_ids)
        b_placeholders = ",".join("?" * len(b_list))
        conn.execute(f"DELETE FROM tags WHERE bookmark_id IN ({b_placeholders})", b_list)
        conn.execute(f"DELETE FROM item_order WHERE item_id IN ({b_placeholders}) AND item_type='bookmark'", b_list)
        conn.execute(f"DELETE FROM bookmarks WHERE id IN ({b_placeholders})", b_list)

    if all_folder_ids:
        f_list = list(all_folder_ids)
        f_placeholders = ",".join("?" * len(f_list))
        conn.execute(f"DELETE FROM item_order WHERE folder_id IN ({f_placeholders})", f_list)
        conn.execute(f"DELETE FROM item_order WHERE item_id IN ({f_placeholders}) AND item_type='folder'", f_list)
        conn.execute(f"DELETE FROM folders WHERE id IN ({f_placeholders})", f_list)

    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})
    broadcast_sync({"type": "trash_changed"})
    conn.close()

    return {
        "status": "deleted",
        "trash_id": trash_id,
        "deleted_bookmark_ids": list(all_bookmark_ids),
        "deleted_folder_ids": list(all_folder_ids)
    }


# ── Bulk import ───────────────────────────────────────────────────────────────

@router.post("/import")
def bulk_import(req: BulkImportRequest, background_tasks: BackgroundTasks):
    if not req.items:
        return {"status": "success", "imported": 0}

    conn = get_db()
    now  = datetime.utcnow().isoformat()

    id_map          = {}
    folder_max_pos  = {}

    def get_cached_position(fid: Optional[str]) -> float:
        if fid not in folder_max_pos:
            row = conn.execute(
                "SELECT MAX(position) FROM item_order WHERE folder_id IS ?", (fid,)
            ).fetchone()
            folder_max_pos[fid] = row[0] if row[0] is not None else 0.0
        folder_max_pos[fid] += REBALANCE_GAP
        return folder_max_pos[fid]

    archived_bids_to_fetch = []
    all_bids_to_screenshot = []
    imported_count         = 0

    try:
        for item in [i for i in req.items if i.type == "folder"]:
            real_id     = make_folder_id()
            id_map[item.id] = real_id
            real_parent = id_map.get(item.parent_id) if item.parent_id else None

            conn.execute(
                "INSERT INTO folders (id, name, parent_id, vault) VALUES (?,?,?,?)",
                (real_id, item.name.strip(), real_parent, req.vault),
            )
            pos = get_cached_position(real_parent)
            conn.execute(
                "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
                (real_parent, real_id, "folder", pos),
            )
            imported_count += 1

        for item in [i for i in req.items if i.type == "bookmark"]:
            norm       = normalize_url(item.url)
            seed       = f"{norm}|{req.vault}|{item.folder_id}|{uuid.uuid4()}"
            real_bid   = make_id(seed)
            real_folder = id_map.get(item.folder_id) if item.folder_id else None
            title       = item.title.strip() if item.title else item.url

            conn.execute("""
                INSERT INTO bookmarks
                    (id, url, url_normalized, title, vault, created_at,
                     archived, screenshot, html_path, screenshot_path, favicon_path, notes, folder_id, favicon_url)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                real_bid, item.url, norm, title, req.vault, now,
                0, 0, None, None, None, "", real_folder, "",
            ))

            pos = get_cached_position(real_folder)
            conn.execute(
                "INSERT INTO item_order (folder_id, item_id, item_type, position) VALUES (?,?,?,?)",
                (real_folder, real_bid, "bookmark", pos),
            )

            if item.archive:
                archived_bids_to_fetch.append(real_bid)
            else:
                all_bids_to_screenshot.append(real_bid)

            imported_count += 1

        conn.commit()
        broadcast_sync({"type": "bookmarks_changed"})
        broadcast_sync({"type": "folders_changed"})

    except Exception as exc:
        conn.rollback()
        raise HTTPException(500, f"Bulk import failed: {str(exc)}")
    finally:
        conn.close()

    from routers.jobs import fetch_worker
    jobs_started = 0

    if all_bids_to_screenshot:
        job_id = str(uuid.uuid4())
        ACTIVE_JOBS[job_id] = {
            "id":      job_id,
            "status":  "running",
            "total":   len(all_bids_to_screenshot),
            "current": 0,
            "type":    "Bulk Import Screenshots",
        }
        background_tasks.add_task(
            fetch_worker, job_id, all_bids_to_screenshot, True, False
        )
        jobs_started += 1

    if archived_bids_to_fetch:
        job_id = str(uuid.uuid4())
        ACTIVE_JOBS[job_id] = {
            "id":      job_id,
            "status":  "running",
            "total":   len(archived_bids_to_fetch),
            "current": 0,
            "type":    "Bulk Import Archive",
        }
        background_tasks.add_task(
            fetch_worker, job_id, archived_bids_to_fetch, True, True
        )
        jobs_started += 1

    return {
        "status":                  "success",
        "imported":                imported_count,
        "background_jobs_started": jobs_started,
    }


@router.post("/items/bulk-move")
def bulk_move_items(req: BulkMoveItemsRequest):
    conn = get_db()

    try:
        if req.target_folder_id is not None:
            _validate_folder(conn, req.target_folder_id)

        if req.folder_ids:
            if req.target_folder_id is not None:
                for fid in req.folder_ids:
                    descendants = descendant_folder_ids(conn, fid)
                    if req.target_folder_id == fid or req.target_folder_id in descendants:
                        conn.close()
                        raise HTTPException(400, "Cannot move a folder into itself or one of its descendants")

            f_placeholders = ",".join("?" * len(req.folder_ids))
            conn.execute(
                f"UPDATE folders SET parent_id=? WHERE id IN ({f_placeholders})",
                [req.target_folder_id] + req.folder_ids,
            )
            for fid in req.folder_ids:
                move_order_row(conn, req.target_folder_id, fid, "folder")

        if req.bookmark_ids:
            b_placeholders = ",".join("?" * len(req.bookmark_ids))
            conn.execute(
                f"UPDATE bookmarks SET folder_id=? WHERE id IN ({b_placeholders})",
                [req.target_folder_id] + req.bookmark_ids,
            )
            for bid in req.bookmark_ids:
                move_order_row(conn, req.target_folder_id, bid, "bookmark")

        conn.commit()
        broadcast_sync({"type": "bookmarks_changed"})
        broadcast_sync({"type": "folders_changed"})

        return {
            "status": "moved",
            "bookmarks_moved": len(req.bookmark_ids) if req.bookmark_ids else 0,
            "folders_moved": len(req.folder_ids) if req.folder_ids else 0,
            "target_folder_id": req.target_folder_id
        }

    except HTTPException:
        raise

    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Server crash during bulk move: {str(e)}")

    finally:
        conn.close()


@router.post("/items/bulk-copy")
def bulk_copy_items(req: BulkCopyItemsRequest):
    conn = get_db()

    try:
        _validate_folder(conn, req.target_folder_id)

        now = datetime.utcnow().isoformat()

        new_bookmarks_response = []
        new_folders_response = []

        def clone_bookmarks(b_ids: list[str], dest_folder_id: Optional[str]):
            if not b_ids:
                return

            placeholders = ",".join("?" * len(b_ids))
            rows = conn.execute(f"SELECT * FROM bookmarks WHERE id IN ({placeholders})", b_ids).fetchall()

            for row in rows:
                d = row_to_dict(row)
                original_tags = get_tags(conn, d["id"])
                target_vault  = req.target_vault or d.get("vault", "default")

                url_val = d.get("url", "")
                seed = f"{url_val}|{dest_folder_id}|{target_vault}|{now}|{uuid.uuid4()}"
                new_bid = make_id(seed)
                new_norm = d.get("url_normalized", "") + f"#copy-{new_bid}"

                conn.execute("""
                    INSERT INTO bookmarks
                        (id, url, url_normalized, title, vault, created_at,
                         archived, screenshot, html_path, screenshot_path, notes, folder_id, favicon_url, favicon_path)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    new_bid, url_val, new_norm, d.get("title", ""),
                    target_vault, now,
                    d.get("archived", 0), d.get("screenshot", 0),
                    d.get("html_path"), d.get("screenshot_path"),
                    d.get("notes", ""), dest_folder_id,
                    d.get("favicon_url", ""), d.get("favicon_path"),
                ))

                for tag in original_tags:
                    conn.execute("INSERT OR IGNORE INTO tags (bookmark_id, tag) VALUES (?,?)", (new_bid, tag))

                ensure_order_row(conn, dest_folder_id, new_bid, "bookmark")

                new_bm = conn.execute("SELECT * FROM bookmarks WHERE id=?", (new_bid,)).fetchone()
                new_bookmarks_response.append(enrich_bookmark(conn, new_bm))

        # 1. Clone top-level standalone bookmarks
        clone_bookmarks(req.bookmark_ids, req.target_folder_id)

        # 2. SNAPSHOT the original folder tree BEFORE creating any copies.
        #    Prevents newly-inserted folders from being picked up as
        #    "children" mid-loop — fixes infinite recursion when pasting
        #    a folder into its own descendant.
        folder_children_map = {}
        folder_bookmarks_map = {}

        def snapshot_subtree(fid):
            if fid in folder_children_map:
                return
            children = conn.execute("SELECT id FROM folders WHERE parent_id=?", (fid,)).fetchall()
            child_ids = [r["id"] for r in children]
            folder_children_map[fid] = child_ids

            bms = conn.execute("SELECT id FROM bookmarks WHERE folder_id=?", (fid,)).fetchall()
            folder_bookmarks_map[fid] = [r["id"] for r in bms]

            for cid in child_ids:
                snapshot_subtree(cid)

        for fid in req.folder_ids:
            snapshot_subtree(fid)

        # 3. Clone Folders (Queue-based Recursive Engine, walking the SNAPSHOT only)
        queue = [(fid, req.target_folder_id) for fid in req.folder_ids]

        while queue:
            old_fid, target_parent_id = queue.pop(0)

            old_folder_row = conn.execute("SELECT * FROM folders WHERE id=?", (old_fid,)).fetchone()
            if not old_folder_row:
                continue

            old_folder = row_to_dict(old_folder_row)
            target_vault = req.target_vault or old_folder.get("vault", "default")

            new_fid = make_folder_id()
            conn.execute(
                "INSERT INTO folders (id, name, parent_id, vault) VALUES (?,?,?,?)",
                (new_fid, old_folder.get("name", "Untitled"), target_parent_id, target_vault)
            )
            ensure_order_row(conn, target_parent_id, new_fid, "folder")

            new_f_row = conn.execute("SELECT * FROM folders WHERE id=?", (new_fid,)).fetchone()
            new_folders_response.append(row_to_dict(new_f_row))

            child_bm_ids = folder_bookmarks_map.get(old_fid, [])
            clone_bookmarks(child_bm_ids, new_fid)

            child_folder_ids = folder_children_map.get(old_fid, [])
            for cfid in child_folder_ids:
                queue.append((cfid, new_fid))

        conn.commit()
        broadcast_sync({"type": "bookmarks_changed"})
        broadcast_sync({"type": "folders_changed"})

        return {
            "status": "copied",
            "new_bookmarks": new_bookmarks_response,
            "new_folders": new_folders_response
        }

    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Server crash during bulk copy: {str(e)}")

    finally:
        conn.close()