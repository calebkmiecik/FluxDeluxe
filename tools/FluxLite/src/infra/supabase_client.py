"""Singleton Supabase client factory.

Reads SUPABASE_URL and SUPABASE_KEY from .env at the repo root.
Returns None when credentials are missing or the library is not installed,
so callers can degrade gracefully.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

_logger = logging.getLogger(__name__)

_client = None
_init_attempted = False


def get_client():
    """Return the shared Supabase client, or *None* if unavailable."""
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True
    try:
        from dotenv import load_dotenv
        from supabase import create_client

        # Walk up from this file to the repo root to find .env
        env_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "..", "..", ".env"
        )
        env_path = os.path.normpath(env_path)
        load_dotenv(env_path)

        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_KEY", "").strip()
        if not url or not key:
            _logger.info("Supabase credentials not configured – upload disabled.")
            return None

        _client = create_client(url, key)
        _logger.info("Supabase client initialised.")
    except ImportError:
        _logger.debug("supabase / python-dotenv not installed – upload disabled.")
    except Exception as exc:
        _logger.warning("Failed to create Supabase client: %s", exc)
    return _client
