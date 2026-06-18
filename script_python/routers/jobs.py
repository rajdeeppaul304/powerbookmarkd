"""
routers/jobs.py - Background job queue for bulk fetch operations.

Endpoints:
  POST /jobs/fetch          – start a new background fetch job
  GET  /jobs                – list all active/completed jobs
  POST /jobs/{job_id}/control – pause / resume / cancel / dismiss a job

Also exports fetch_worker so routers/bulk.py can schedule import jobs
via FastAPI's BackgroundTasks without a circular import at module load time.
"""

import asyncio
import uuid

from fastapi import APIRouter
from playwright.async_api import async_playwright

from database import get_db, ARCHIVE_DIR, FAVICON_DIR
from models import FetchRequest, JobControl
from services.playwright import fetch_page
from state import ACTIVE_JOBS, manager, broadcast_sync

router = APIRouter()


# ── Background worker ─────────────────────────────────────────────────────────

async def fetch_worker(
    job_id: str,
    bookmark_ids: list[str],
    do_screenshot: bool,
    do_archive: bool,
):
    conn = get_db()
    try:
        # Initialize error tracking arrays if they don't exist
        if job_id in ACTIVE_JOBS:
            ACTIVE_JOBS[job_id].setdefault("errors", [])
            ACTIVE_JOBS[job_id].setdefault("success_count", 0)

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 800})

            for bid in bookmark_ids:
                # ── Pause / cancel check ──────────────────────────────────────
                while ACTIVE_JOBS.get(job_id, {}).get("status") == "paused":
                    await asyncio.sleep(1)

                if ACTIVE_JOBS.get(job_id, {}).get("status") == "canceled":
                    break

                # ── Load bookmark from DB ─────────────────────────────────────
                row = conn.execute(
                    "SELECT url, html_path, favicon_path, archived, screenshot_path "
                    "FROM bookmarks WHERE id=?",
                    (bid,),
                ).fetchone()
                
                if not row:
                    if job_id in ACTIVE_JOBS:
                        ACTIVE_JOBS[job_id]["current"] += 1
                    continue

                url = row["url"]
                page = await context.new_page()

                try:
                    result = await fetch_page(
                        page, url, bid,
                        do_screenshot=do_screenshot,
                        do_archive=do_archive,
                        existing_html_path=row["html_path"],
                        existing_favicon_path=row["favicon_path"],
                    )

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
                    await manager.broadcast({"type": "bookmarks_changed"})

                    # Check for partial failures (e.g. single-file failed, but screenshot worked)
                    if result.errors and job_id in ACTIVE_JOBS:
                        for err in result.errors:
                            phase = "archive" if "single-file" in err else "favicon"
                            ACTIVE_JOBS[job_id]["errors"].append({
                                "url": url, "phase": phase, "message": err
                            })
                    elif job_id in ACTIVE_JOBS:
                        ACTIVE_JOBS[job_id]["success_count"] += 1

                except Exception as exc:
                    # Catch total page failures like TimeoutError
                    print(f"fetch_worker: failed for {url}: {exc}")
                    if job_id in ACTIVE_JOBS:
                        # Clean up the error string so it's readable for the UI
                        err_str = str(exc).split("Call log:")[0].strip()
                        ACTIVE_JOBS[job_id]["errors"].append({
                            "url": url, 
                            "phase": "page_load", 
                            "message": err_str
                        })
                finally:
                    if not page.is_closed():
                        await page.close()

                if job_id in ACTIVE_JOBS:
                    ACTIVE_JOBS[job_id]["current"] += 1
                    await manager.broadcast({"type": "jobs_changed"})


            await browser.close()

        if job_id in ACTIVE_JOBS and ACTIVE_JOBS[job_id]["status"] != "canceled":
            ACTIVE_JOBS[job_id]["status"] = "completed"

    except Exception as exc:
        print(f"fetch_worker: job {job_id} crashed: {exc}")
        if job_id in ACTIVE_JOBS:
            ACTIVE_JOBS[job_id]["status"] = "error"
            ACTIVE_JOBS[job_id].setdefault("errors", []).append({
                "url": "System", "phase": "crash", "message": str(exc)
            })
    finally:
        conn.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/jobs/fetch")
async def start_fetch_job(req: FetchRequest):
    job_id = str(uuid.uuid4())
    ACTIVE_JOBS[job_id] = {
        "id":      job_id,
        "status":  "running",
        "total":   len(req.bookmark_ids),
        "current": 0,
        "type":    "Bulk Fetch",
        "success_count": 0,
        "errors": []
    }
    asyncio.create_task(
        fetch_worker(job_id, req.bookmark_ids, req.fetch_screenshot, req.fetch_archive)
    )
    return {"job_id": job_id}


@router.get("/jobs")
def get_all_jobs():
    return {"jobs": list(ACTIVE_JOBS.values())}


@router.post("/jobs/{job_id}/control")
def control_job(job_id: str, req: JobControl):
    if job_id not in ACTIVE_JOBS:
        return {"status": "not_found"}

    if req.action == "dismiss":
        del ACTIVE_JOBS[job_id]
    elif req.action == "pause":
        ACTIVE_JOBS[job_id]["status"] = "paused"
    elif req.action == "resume":
        ACTIVE_JOBS[job_id]["status"] = "running"
    elif req.action == "cancel":
        ACTIVE_JOBS[job_id]["status"] = "canceled"
    broadcast_sync({"type": "jobs_changed"})
    return {"status": "success"}