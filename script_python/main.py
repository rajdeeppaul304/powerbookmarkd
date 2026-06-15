"""
main.py - powerbookmarkd entry point.

Wires together the FastAPI app, middleware, static mounts, and all routers.
Run with:  uvicorn main:app --host 127.0.0.1 --port 8765
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import ARCHIVE_DIR, FAVICON_DIR, init_db
from routers import bookmarks, bulk, fetch, folders, jobs, vaults

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="powerbookmarkd", version="1.3.0")

# ── Middleware ────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static file mounts ────────────────────────────────────────────────────────

app.mount("/static/archive",  StaticFiles(directory=str(ARCHIVE_DIR)),  name="archive")
app.mount("/static/favicons", StaticFiles(directory=str(FAVICON_DIR)), name="favicons")

# ── DB init ───────────────────────────────────────────────────────────────────

init_db()

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(bookmarks.router)
app.include_router(folders.router)
app.include_router(vaults.router)
app.include_router(fetch.router)
app.include_router(jobs.router)
app.include_router(bulk.router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "powerbookmarkd", "version": "1.3.0"}