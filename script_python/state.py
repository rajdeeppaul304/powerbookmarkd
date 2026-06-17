"""
state.py - Process-level shared state.

Kept in its own module so that routers/jobs.py and routers/fetch.py
can both import ACTIVE_JOBS without a circular dependency.
"""

from typing import Dict, Any, List
import asyncio
from fastapi import WebSocket

# job_id -> { id, status, total, current, type }
ACTIVE_JOBS: Dict[str, Any] = {}


class ConnectionManager:
    """Tracks active WebSocket connections and broadcasts events to all of them."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)


manager = ConnectionManager()


def broadcast_sync(message: dict):
    """
    Fire-and-forget broadcast callable from synchronous route handlers
    (your routers are all plain `def`, not `async def`, since they use
    sqlite3 synchronously). Schedules the async broadcast on the running
    event loop without blocking the request thread.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(manager.broadcast(message), loop)
    except RuntimeError:
        # No running loop (shouldn't happen under uvicorn), just skip silently
        pass