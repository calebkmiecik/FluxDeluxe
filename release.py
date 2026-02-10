"""Local release script for FluxDeluxe.

Builds the app, zips the dist folder, and publishes a GitHub Release.

Usage:
    python release.py 1.2.0          # build + release v1.2.0
    python release.py 1.2.0 --skip-build   # release from existing dist/
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION_FILE = ROOT / "fluxdeluxe" / "__version__.py"
INSTALLER_ISS = ROOT / "installer.iss"
DIST = ROOT / "dist" / "FluxDeluxe"


def _gh_exe() -> str:
    """Return the full path to the gh CLI."""
    full = r"C:\Program Files\GitHub CLI\gh.exe"
    if Path(full).exists():
        return full
    return "gh"


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess[str]:
    print(f"  > {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, **kw)


def stamp_version(version: str) -> None:
    """Write version into __version__.py and installer.iss."""
    print(f"\n  Stamping version {version}")
    VERSION_FILE.write_text(f'__version__ = "{version}"\n', encoding="utf-8")

    if INSTALLER_ISS.exists():
        text = INSTALLER_ISS.read_text(encoding="utf-8")
        text = re.sub(
            r'#define MyAppVersion ".*?"',
            f'#define MyAppVersion "{version}"',
            text,
        )
        INSTALLER_ISS.write_text(text, encoding="utf-8")


def build() -> None:
    """Run the full build pipeline."""
    print("\n  Running build.py ...")
    _run([sys.executable, str(ROOT / "build.py"), "--skip-installer"])


def create_zip(version: str) -> Path:
    """Zip the dist folder."""
    zip_name = f"FluxDeluxe-v{version}"
    zip_path = ROOT / "output" / zip_name
    (ROOT / "output").mkdir(exist_ok=True)

    # Remove old zip if it exists
    full_zip = Path(f"{zip_path}.zip")
    if full_zip.exists():
        full_zip.unlink()

    print(f"\n  Creating {full_zip.name} ...")
    shutil.make_archive(str(zip_path), "zip", DIST.parent, DIST.name)
    print(f"  Created: {full_zip} ({full_zip.stat().st_size / 1024 / 1024:.1f} MB)")
    return full_zip



def build_installer(version: str) -> Path | None:
    """Build the Inno Setup installer if ISCC.exe is available."""
    iss_path = ROOT / "installer.iss"
    if not iss_path.exists():
        print("  installer.iss not found — skipping installer")
        return None

    iscc_candidates = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]
    iscc = next((c for c in iscc_candidates if Path(c).exists()), None)
    if iscc is None:
        print("  Inno Setup (ISCC.exe) not found — skipping installer")
        return None

    print(f"\n  Building installer ...")
    _run([iscc, str(iss_path)])
    installer = ROOT / "output" / f"FluxDeluxe_Setup_v{version}.exe"
    if installer.exists():
        print(f"  Installer: {installer} ({installer.stat().st_size / 1024 / 1024:.1f} MB)")
    return installer if installer.exists() else None

def gh_release(version: str, zip_path: Path, installer_path: Path | None = None) -> None:
    """Create a GitHub Release and upload assets."""
    tag = f"v{version}"

    # Check gh auth
    try:
        _run([_gh_exe(), "auth", "status"], capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("\n  ERROR: gh CLI not authenticated. Run: gh auth login")
        sys.exit(1)

    # Tag locally
    try:
        _run(["git", "tag", tag], cwd=str(ROOT))
    except subprocess.CalledProcessError:
        print(f"  Tag {tag} already exists locally, reusing.")

    # Push tag
    _run(["git", "push", "origin", tag], cwd=str(ROOT))

    # Build asset list
    assets = [str(zip_path)]
    if installer_path and installer_path.exists():
        assets.append(str(installer_path))

    # Create release with assets
    print(f"\n  Creating GitHub Release {tag} ...")
    _run([
        _gh_exe(), "release", "create", tag,
        *assets,
        "--title", f"FluxDeluxe v{version}",
        "--generate-notes",
    ], cwd=str(ROOT))

    print(f"\n  Release published: https://github.com/calebkmiecik/FluxDeluxe/releases/tag/{tag}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build & release FluxDeluxe")
    parser.add_argument("version", help="Version number (e.g. 1.0.0)")
    parser.add_argument("--skip-build", action="store_true",
                        help="Skip build, release from existing dist/")
    parser.add_argument("--skip-installer", action="store_true",
                        help="Skip Inno Setup installer creation")
    args = parser.parse_args()

    version = args.version.lstrip("vV")

    stamp_version(version)

    if not args.skip_build:
        build()

    if not DIST.exists():
        print(f"  ERROR: {DIST} not found. Run without --skip-build first.")
        sys.exit(1)

    zip_path = create_zip(version)

    installer_path = None
    if not args.skip_installer:
        installer_path = build_installer(version)

    gh_release(version, zip_path, installer_path)

    print("\n  Done! Your coworkers' apps will see the update on next launch.")


if __name__ == "__main__":
    main()
