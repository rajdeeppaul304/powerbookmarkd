import asyncio
from fastapi import WebSocket
from typing import Dict, Any, List

ACTIVE_JOBS: Dict[str, Any] = {}
_event_loop = None  # set once at startup

def set_event_loop(loop):
    global _event_loop
    _event_loop = loop


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)


manager = ConnectionManager()


def broadcast_sync(message: dict):
    if _event_loop and _event_loop.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), _event_loop)