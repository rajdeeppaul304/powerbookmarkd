"""
main.py - powerbookmarkd entry point.

Wires together the FastAPI app, middleware, static mounts, and all routers.
Run with:  uvicorn main:app --host 127.0.0.1 --port 8765
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import ARCHIVE_DIR, FAVICON_DIR, init_db
from routers import bookmarks, bulk, fetch, folders, jobs, vaults, trash

import asyncio
import httpx
from contextlib import asynccontextmanager
from fastapi import WebSocket, WebSocketDisconnect
from state import manager


async def cron_purge_expired():
    """Every 5 minutes, purge trash entries older than 7 days."""
    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(300)  # 5 minutes
            try:
                await client.post("http://127.0.0.1:8765/trash/purge-expired")
            except Exception as e:
                print(f"Cron purge failed: {e}")

@asynccontextmanager
async def lifespan(app):
    asyncio.create_task(cron_purge_expired())
    yield

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="powerbookmarkd", version="1.4.0", lifespan=lifespan)

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
app.include_router(trash.router)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "powerbookmarkd", "version": "1.3.0"}



@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # we don't expect client messages, just keep alive
    except WebSocketDisconnect:
        manager.disconnect(websocket)
