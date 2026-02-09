"""Freeze-aware runtime helpers for FluxDeluxe.

Provides utilities that work both in normal development mode and when the
application has been packaged with PyInstaller.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

_logger = logging.getLogger(__name__)


def is_frozen() -> bool:
    """Return True when running inside a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def get_app_dir() -> Path:
    """Return the root application directory.

    * **Frozen:** the folder that contains the .exe (PyInstaller ``_MEIPASS``
      is for *bundled data*; this returns the actual install dir).
    * **Dev:** the repository root (parent of the ``fluxdeluxe`` package).
    """
    if is_frozen():
        # sys.executable is the .exe; its parent is the install dir
        return Path(sys.executable).resolve().parent
    # Dev: this file is fluxdeluxe/runtime.py → parent.parent = repo root
    return Path(__file__).resolve().parent.parent


def get_bundle_dir() -> Path:
    """Return the PyInstaller data directory (``sys._MEIPASS``) when frozen,
    or the ``fluxdeluxe`` package directory in dev mode.

    Use this for assets that are *bundled into the exe* (icons, QSS, etc.).
    """
    if is_frozen():
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent


def resource_path(*parts: str) -> Path:
    """Resolve a resource path relative to the bundle/package directory.

    Example::

        icon = resource_path("ui", "assets", "icons", "fluxliteicon.svg")
    """
    return get_bundle_dir().joinpath(*parts)


def get_python_executable() -> str:
    """Return a Python interpreter suitable for spawning subprocesses.

    * **Frozen:** ``<install_dir>/python/python.exe`` (embedded Python shipped
      alongside the packaged app).
    * **Dev:** ``sys.executable`` (the current conda / venv interpreter).
    """
    if is_frozen():
        embedded = get_app_dir() / "python" / "python.exe"
        if embedded.exists():
            return str(embedded)
        _logger.warning(
            "Embedded Python not found at %s – falling back to sys.executable",
            embedded,
        )
    return sys.executable
