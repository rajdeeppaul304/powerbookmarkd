"""
routers/fetch.py - Playwright-powered page fetch endpoints.

  POST /fetch-meta              – fetch title + screenshot for a URL (pre-save preview)
  POST /bookmark/{bid}/fetch    – refresh screenshot/archive for a saved bookmark
  POST /bookmarks/bulk-fetch    – synchronous bulk fetch (legacy; prefer /jobs/fetch)
"""

import base64
from pathlib import Path
from typing import Optional
from state import broadcast_sync

from fastapi import APIRouter, HTTPException
from playwright.async_api import async_playwright

from database import get_db, ARCHIVE_DIR
from models import BookmarkFetchRequest, BulkFetchRequest, FetchMetaRequest
from services.playwright import fetch_page
from utils import enrich_bookmark, normalize_url, make_id

router = APIRouter()


# ── /fetch-meta ───────────────────────────────────────────────────────────────

@router.post("/fetch-meta")
async def fetch_meta(req: FetchMetaRequest):
    """
    Load a URL with Playwright and return its title plus a base64 screenshot.
    Used by the frontend to preview a page before the user saves it.
    """
    norm = normalize_url(req.url)
    bid  = make_id(norm)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page    = await context.new_page()

        try:
            result = await fetch_page(
                page, req.url, bid,
                do_screenshot=True,
                do_archive=req.archive,
            )
        except Exception as exc:
            raise HTTPException(500, f"Failed to fetch metadata: {exc}")
        finally:
            if not page.is_closed():
                await page.close()
            await browser.close()

    if not result.screenshot_path:
        raise HTTPException(500, "Screenshot was not captured")

    screenshot_bytes = Path(result.screenshot_path).read_bytes()
    screenshot_b64   = base64.b64encode(screenshot_bytes).decode("utf-8")

    return {
        "title":      result.title or "",
        "screenshot": f"data:image/jpeg;base64,{screenshot_b64}",
    }


# ── /bookmark/{bid}/fetch ─────────────────────────────────────────────────────

@router.post("/bookmark/{bid}/fetch")
async def fetch_bookmark_archive(bid: str, req: BookmarkFetchRequest):
    """Refresh the screenshot, favicon, and optionally HTML archive for a single bookmark."""
    conn = get_db()
    row  = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Bookmark not found")

    url                  = row["url"]
    existing_html_path   = row["html_path"]
    existing_favicon_path = row["favicon_path"]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})
        page    = await context.new_page()

        try:
            result = await fetch_page(
                page, url, bid,
                do_screenshot=True,
                do_archive=req.archive,
                existing_html_path=existing_html_path,
                existing_favicon_path=existing_favicon_path,
            )
        except Exception as exc:
            conn.close()
            raise HTTPException(500, f"Failed to fetch page: {exc}")
        finally:
            if not page.is_closed():
                await page.close()
            await browser.close()

    conn.execute("""
        UPDATE bookmarks
        SET screenshot=1, screenshot_path=?, archived=?, html_path=?, favicon_path=?
        WHERE id=?
    """, (
        result.screenshot_path,
        1 if result.archived else row["archived"],
        result.html_path,
        result.favicon_path,
        bid,
    ))
    conn.commit()
    broadcast_sync({"type": "bookmarks_changed"})


    updated = conn.execute("SELECT * FROM bookmarks WHERE id=?", (bid,)).fetchone()
    d       = enrich_bookmark(conn, updated)
    conn.close()
    return d


# ── /bookmarks/bulk-fetch ─────────────────────────────────────────────────────

@router.post("/bookmarks/bulk-fetch")
async def bulk_fetch_archives(req: BulkFetchRequest):
    """
    Synchronous bulk fetch — blocks until all bookmarks are processed.
    Prefer POST /jobs/fetch for large batches (non-blocking with progress tracking).
    """
    if not req.ids:
        raise HTTPException(400, "No bookmark IDs provided")

    conn = get_db()
    placeholders = ",".join("?" * len(req.ids))
    rows = conn.execute(
        f"SELECT * FROM bookmarks WHERE id IN ({placeholders})", req.ids
    ).fetchall()
    conn.close()

    if not rows:
        raise HTTPException(404, "None of the requested bookmarks were found")

    successful_ids = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 800})

        for row in rows:
            bid  = row["id"]
            url  = row["url"]
            page = await context.new_page()

            try:
                result = await fetch_page(
                    page, url, bid,
                    do_screenshot=True,
                    do_archive=req.archive,
                    existing_html_path=row["html_path"],
                    existing_favicon_path=row["favicon_path"],
                )

                db = get_db()
                db.execute("""
                    UPDATE bookmarks
                    SET screenshot=1, screenshot_path=?, archived=?, html_path=?, favicon_path=?
                    WHERE id=?
                """, (
                    result.screenshot_path,
                    1 if result.archived else row["archived"],
                    result.html_path,
                    result.favicon_path,
                    bid,
                ))
                db.commit()
                broadcast_sync({"type": "bookmarks_changed"})
                db.close()

                successful_ids.append(bid)

            except Exception as exc:
                print(f"Failed to bulk-fetch {url}: {exc}")
            finally:
                if not page.is_closed():
                    await page.close()

        await browser.close()

    return {
        "status":           "completed",
        "total_requested":  len(req.ids),
        "successful_count": len(successful_ids),
        "successful_ids":   successful_ids,
    }