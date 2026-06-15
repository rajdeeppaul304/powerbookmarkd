"""
services/playwright.py - Shared browser automation logic.

All endpoints that need to fetch a live page, take a screenshot,
grab a favicon, or archive HTML import from here instead of
duplicating the Playwright boilerplate.
"""

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from playwright.async_api import Browser, BrowserContext, Page

from database import ARCHIVE_DIR, FAVICON_DIR

# ── JS snippet to resolve the best favicon URL from a loaded page ─────────────
JS_GET_FAVICON = """() => {
    let el = document.querySelector('link[rel~="icon"]');
    if (!el) el = document.querySelector('link[rel="shortcut icon"]');
    return el ? el.href : new URL('/favicon.ico', document.baseURI).href;
}"""


@dataclass
class FetchResult:
    """Outcome of a single-page fetch operation."""
    screenshot_path: Optional[str] = None
    favicon_path: Optional[str] = None
    html_path: Optional[str] = None
    title: Optional[str] = None
    archived: bool = False
    errors: list = field(default_factory=list)


async def fetch_page(
    page: Page,
    url: str,
    bid: str,
    *,
    do_screenshot: bool = True,
    do_archive: bool = False,
    existing_html_path: Optional[str] = None,
    existing_favicon_path: Optional[str] = None,
) -> FetchResult:
    """
    Navigate to `url` on an already-open Playwright page and collect assets.

    The caller is responsible for opening and closing the page.  This keeps
    the function composable — callers that process many URLs in a loop can
    reuse a single browser context and open/close pages themselves.

    Args:
        page:                 An open Playwright Page (not yet navigated).
        url:                  The URL to load.
        bid:                  Bookmark ID used as the filename stem for saved assets.
        do_screenshot:        Whether to capture a JPEG screenshot.
        do_archive:           Whether to run single-file to save a full HTML archive.
        existing_html_path:   Current html_path value from the DB (preserved if archiving is skipped).
        existing_favicon_path: Current favicon_path from the DB (preserved if fetch fails).

    Returns:
        FetchResult with paths for any assets that were successfully saved.
    """
    result = FetchResult(
        html_path=existing_html_path,
        favicon_path=existing_favicon_path,
    )

    # ── Navigate ──────────────────────────────────────────────────────────────
    await page.goto(url, timeout=20_000, wait_until="networkidle")
    result.title = await page.title()

    # ── Screenshot ────────────────────────────────────────────────────────────
    if do_screenshot:
        ss_path = str(ARCHIVE_DIR / f"{bid}.jpeg")
        await page.screenshot(path=ss_path, type="jpeg", quality=80, full_page=False)
        result.screenshot_path = ss_path

    # ── Favicon ───────────────────────────────────────────────────────────────
    try:
        fav_url = await page.evaluate(JS_GET_FAVICON)
        if fav_url:
            fav_res = await page.request.get(fav_url, timeout=5_000)
            if fav_res.ok:
                fav_disk_path = FAVICON_DIR / f"{bid}.ico"
                fav_disk_path.write_bytes(await fav_res.body())
                result.favicon_path = str(fav_disk_path)
    except Exception as exc:
        result.errors.append(f"favicon: {exc}")

    # ── HTML archive via single-file CLI ──────────────────────────────────────
    if do_archive:
        target_path = str(ARCHIVE_DIR / f"{bid}.html")
        cmd = [
            "single-file",
            url,
            target_path,
            "--browser-executable-path", "/usr/bin/chromium",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode == 0:
            result.html_path = target_path
            result.archived  = True
        else:
            err = stderr.decode("utf-8")
            result.errors.append(f"single-file: {err}")

    return result