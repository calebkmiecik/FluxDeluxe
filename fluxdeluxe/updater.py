"""In-app auto-updater for FluxDeluxe.

Checks GitHub Releases for a newer version, downloads the release asset,
and applies the update by launching a helper script that replaces files
while the main app is closed.
"""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

from .__version__ import __version__
from .runtime import get_app_dir, is_frozen

_logger = logging.getLogger(__name__)

GITHUB_OWNER = "calebkmiecik"
GITHUB_REPO = "FluxDeluxe"
RELEASES_API = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
)
# The release asset must be a .zip whose name contains this substring.
ASSET_NAME_HINT = "FluxDeluxe"


@dataclass
class UpdateInfo:
    """Metadata about an available update."""

    version: str
    download_url: str
    changelog: str
    asset_name: str


def _parse_version(tag: str) -> tuple[int, ...]:
    """Parse a semver-ish tag like ``v1.2.3`` or ``1.2.3`` into a tuple."""
    clean = tag.lstrip("vV").strip()
    parts: list[int] = []
    for segment in clean.split("."):
        try:
            parts.append(int(segment))
        except ValueError:
            break
    return tuple(parts)


def current_version() -> str:
    return __version__


def check_for_update(timeout: float = 10.0) -> Optional[UpdateInfo]:
    """Check GitHub Releases for a version newer than the running one.

    Returns *None* when the app is already up-to-date (or the check fails).
    """
    try:
        resp = requests.get(
            RELEASES_API,
            headers={"Accept": "application/vnd.github+json"},
            timeout=timeout,
        )
        resp.raise_for_status()
    except Exception as exc:
        _logger.warning("Update check failed: %s", exc)
        return None

    data = resp.json()
    tag: str = data.get("tag_name", "")
    remote_ver = _parse_version(tag)
    local_ver = _parse_version(__version__)

    if not remote_ver or remote_ver <= local_ver:
        _logger.info("Up to date (local=%s, remote=%s)", __version__, tag)
        return None

    # Find the .zip asset
    for asset in data.get("assets", []):
        name: str = asset.get("name", "")
        if name.endswith(".zip") and ASSET_NAME_HINT.lower() in name.lower():
            return UpdateInfo(
                version=tag.lstrip("vV"),
                download_url=asset["browser_download_url"],
                changelog=data.get("body", "") or "",
                asset_name=name,
            )

    _logger.warning("Release %s found but no matching .zip asset", tag)
    return None


def download_update(info: UpdateInfo, dest_dir: Path) -> Path:
    """Download the release zip into *dest_dir* and return its path."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / info.asset_name

    _logger.info("Downloading %s …", info.download_url)
    resp = requests.get(info.download_url, stream=True, timeout=120)
    resp.raise_for_status()

    with open(zip_path, "wb") as fh:
        for chunk in resp.iter_content(chunk_size=1 << 16):
            fh.write(chunk)

    _logger.info("Downloaded %s (%d bytes)", zip_path, zip_path.stat().st_size)
    return zip_path


def apply_update(zip_path: Path) -> None:
    """Extract the update and launch the updater script, then exit.

    The updater script waits for this process to exit, copies the new files
    over the install directory, and relaunches the app.

    **Only works in frozen (packaged) mode.**
    """
    if not is_frozen():
        _logger.warning("apply_update called in dev mode – skipping")
        return

    install_dir = get_app_dir()
    staging_dir = Path(tempfile.mkdtemp(prefix="fluxdeluxe_update_"))

    _logger.info("Extracting %s → %s", zip_path, staging_dir)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(staging_dir)

    # The zip may contain a single top-level folder; detect and use it.
    children = list(staging_dir.iterdir())
    if len(children) == 1 and children[0].is_dir():
        source_dir = children[0]
    else:
        source_dir = staging_dir

    exe_name = Path(sys.executable).name
    updater_bat = staging_dir / "_updater.bat"
    updater_bat.write_text(
        f'@echo off\r\n'
        f'echo Updating FluxDeluxe — please wait...\r\n'
        f'timeout /t 3 /nobreak >nul\r\n'
        f'xcopy /E /Y /I /Q "{source_dir}\\*" "{install_dir}\\"\r\n'
        f'echo Update complete. Restarting...\r\n'
        f'start "" "{install_dir}\\{exe_name}"\r\n'
        f'del "{zip_path}" 2>nul\r\n'
        f'rmdir /S /Q "{staging_dir}" 2>nul\r\n',
        encoding="utf-8",
    )

    _logger.info("Launching updater script and exiting…")
    subprocess.Popen(  # noqa: S603
        ["cmd.exe", "/C", str(updater_bat)],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    sys.exit(0)
