"""
state.py - Process-level shared state.

Kept in its own module so that routers/jobs.py and routers/fetch.py
can both import ACTIVE_JOBS without a circular dependency.
"""

from typing import Dict, Any

# job_id -> { id, status, total, current, type }
ACTIVE_JOBS: Dict[str, Any] = {}