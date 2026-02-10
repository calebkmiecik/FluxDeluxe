"""Build script for FluxDeluxe.

Automates the full build pipeline:
  1. Sync the DynamoDeluxe git submodule
  2. Download / prepare an embedded Python (for backend subprocesses)
  3. Run PyInstaller to freeze the Qt app
  4. Assemble the final dist folder (copy DynamoDeluxe, tools, embedded Python)
  5. (Optional) Run Inno Setup to create an installer exe

Usage:
    python build.py                   # full build
    python build.py --skip-installer  # build without creating the installer
    python build.py --clean           # wipe build/ and dist/ before building

Requires:
    pip install pyinstaller
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist" / "FluxDeluxe"
BUILD = ROOT / "build"
SPEC = ROOT / "FluxDeluxe.spec"
EMBEDDED_PYTHON_DIR = ROOT / "build" / "python_embedded"
PYTHON_VERSION = "3.11.9"
PYTHON_EMBED_URL = (
    f"https://www.python.org/ftp/python/{PYTHON_VERSION}/"
    f"python-{PYTHON_VERSION}-embed-amd64.zip"
)
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"
BACKEND_REQS = ROOT / "requirements_backend.txt"


def _log(msg: str) -> None:
    print(f"\n{'='*60}\n  {msg}\n{'='*60}")


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    print(f"  > {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, **kwargs)


# ── Step 1: Git submodule ─────────────────────────────────────────────────

def sync_submodule() -> None:
    _log("Step 1: Syncing DynamoDeluxe submodule")
    dynamo_dir = ROOT / "fluxdeluxe" / "DynamoDeluxe"
    dynamo_main = dynamo_dir / "app" / "main.py"

    # If DynamoDeluxe already has content, just update it
    if dynamo_main.exists():
        print("  DynamoDeluxe already present, updating...")
    else:
        # Try normal submodule init first
        try:
            _run(["git", "submodule", "update", "--init", "--recursive"], cwd=str(ROOT))
        except subprocess.CalledProcessError:
            print("  Normal submodule init failed (stale commit pointer?).")
            print("  Falling back to fresh clone on dev branch...")

            # On Windows, .git pack files can be locked. Use `git clean`
            # or `rd /s /q` via cmd to handle locked files, then clone fresh.
            if dynamo_dir.exists():
                _run(["cmd.exe", "/C", "rd", "/S", "/Q", str(dynamo_dir)])
            dynamo_dir.mkdir(parents=True, exist_ok=True)

            _run([
                "git", "clone", "--branch", "dev", "--single-branch",
                "https://github.com/Axioforce/AxioforceDynamoPy.git",
                str(dynamo_dir),
            ])

    # Regardless of how we got here, make sure we're on the latest dev
    if dynamo_main.exists():
        try:
            _run(["git", "fetch", "origin", "dev"], cwd=str(dynamo_dir))
            _run(["git", "checkout", "dev"], cwd=str(dynamo_dir))
            _run(["git", "pull", "origin", "dev"], cwd=str(dynamo_dir))
            print("  DynamoDeluxe is on latest dev.")
        except subprocess.CalledProcessError as exc:
            print(f"  WARNING: Could not update DynamoDeluxe to latest dev: {exc}")
    else:
        print("  WARNING: DynamoDeluxe app/main.py not found after sync.")


# ── Step 2: Embedded Python ──────────────────────────────────────────────

def prepare_embedded_python() -> Path:
    _log("Step 2: Preparing embedded Python")
    target = EMBEDDED_PYTHON_DIR
    python_exe = target / "python.exe"

    if python_exe.exists():
        print("  Embedded Python already exists, skipping download.")
    else:
        target.mkdir(parents=True, exist_ok=True)

        # Download embeddable zip
        zip_path = target.parent / f"python-{PYTHON_VERSION}-embed-amd64.zip"
        if not zip_path.exists():
            print(f"  Downloading {PYTHON_EMBED_URL} ...")
            urllib.request.urlretrieve(PYTHON_EMBED_URL, zip_path)
        print(f"  Extracting to {target} ...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(target)

        # Enable `import site` so pip and site-packages work.
        # The ._pth file disables site by default in embeddable distributions.
        pth_files = list(target.glob("python*._pth"))
        for pth in pth_files:
            text = pth.read_text(encoding="utf-8")
            text = text.replace("#import site", "import site")
            pth.write_text(text, encoding="utf-8")
            print(f"  Patched {pth.name}")

    # Install pip if not present
    pip_exe = target / "Scripts" / "pip.exe"
    if not pip_exe.exists():
        get_pip = target.parent / "get-pip.py"
        if not get_pip.exists():
            print(f"  Downloading get-pip.py ...")
            urllib.request.urlretrieve(GET_PIP_URL, get_pip)
        print("  Installing pip into embedded Python ...")
        _run([str(python_exe), str(get_pip), "--no-warn-script-location"])

    # Install backend dependencies
    print("  Installing backend dependencies ...")
    _run([
        str(python_exe), "-m", "pip", "install",
        "--no-warn-script-location",
        "-r", str(BACKEND_REQS),
    ])

    # Install tflite-runtime from local wheel in DynamoDeluxe
    tflite_wheel = (
        ROOT / "fluxdeluxe" / "DynamoDeluxe" / "tflite-runtime"
        / "win_amd64" / "tflite_runtime-2.13.0-cp311-cp311-win_amd64.whl"
    )
    if tflite_wheel.exists():
        print("  Installing tflite-runtime from local wheel ...")
        _run([
            str(python_exe), "-m", "pip", "install",
            "--no-warn-script-location",
            str(tflite_wheel),
        ])
    else:
        print(f"  WARNING: tflite-runtime wheel not found at {tflite_wheel}")

    return target


# ── Step 3: PyInstaller ──────────────────────────────────────────────────

def run_pyinstaller() -> None:
    _log("Step 3: Running PyInstaller")
    _run([
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        str(SPEC),
    ], cwd=str(ROOT))


# ── Step 4: Assemble dist ───────────────────────────────────────────────

def assemble_dist(embedded_python: Path) -> None:
    _log("Step 4: Assembling dist folder")

    # Copy embedded Python
    dest_python = DIST / "python"
    if dest_python.exists():
        shutil.rmtree(dest_python)
    print(f"  Copying embedded Python -> {dest_python}")
    shutil.copytree(embedded_python, dest_python)

    # Strip runtime-unnecessary packages from embedded Python copy
    site_packages = dest_python / "Lib" / "site-packages"
    strip_dirs = ["pip", "setuptools", "pydeck", "pkg_resources", "pythonwin"]
    for name in strip_dirs:
        for match in site_packages.glob(f"{name}*"):
            if match.is_dir():
                shutil.rmtree(match)
                print(f"  Stripped {match.name}")

    # Strip __pycache__, test dirs, and .pyc files to save space
    stripped_bytes = 0
    for pattern in ("__pycache__", "test", "tests"):
        for match in site_packages.rglob(pattern):
            if match.is_dir() and match.name == pattern:
                size = sum(f.stat().st_size for f in match.rglob("*") if f.is_file())
                shutil.rmtree(match)
                stripped_bytes += size
    for pyc in site_packages.rglob("*.pyc"):
        stripped_bytes += pyc.stat().st_size
        pyc.unlink()
    print(f"  Stripped cache/test dirs: {stripped_bytes / 1024 / 1024:.1f} MB")

    # Copy DynamoDeluxe source (submodule)
    src_dynamo = ROOT / "fluxdeluxe" / "DynamoDeluxe"
    dest_dynamo = DIST / "fluxdeluxe" / "DynamoDeluxe"
    if src_dynamo.exists():
        if dest_dynamo.exists():
            shutil.rmtree(dest_dynamo)
        print(f"  Copying DynamoDeluxe -> {dest_dynamo}")
        shutil.copytree(
            src_dynamo, dest_dynamo,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"),
        )
    else:
        print("  WARNING: DynamoDeluxe submodule not found — skipping")

    # Copy tools/
    src_tools = ROOT / "tools"
    dest_tools = DIST / "tools"
    if src_tools.exists():
        if dest_tools.exists():
            shutil.rmtree(dest_tools)
        print(f"  Copying tools -> {dest_tools}")
        shutil.copytree(
            src_tools, dest_tools,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"),
        )

    print("  Dist assembly complete.")


# ── Step 5: Inno Setup (optional) ────────────────────────────────────────

def run_inno_setup() -> None:
    _log("Step 5: Building installer with Inno Setup")
    iss_path = ROOT / "installer.iss"
    if not iss_path.exists():
        print("  installer.iss not found — skipping")
        return

    # Try standard install locations for Inno Setup compiler
    iscc_candidates = [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]
    iscc = None
    for candidate in iscc_candidates:
        if Path(candidate).exists():
            iscc = candidate
            break

    if iscc is None:
        print("  Inno Setup (ISCC.exe) not found — skipping installer creation")
        print("  Install from: https://jrsoftware.org/isdl.php")
        return

    _run([iscc, str(iss_path)])
    print("  Installer created in output/")


# ── Main ─────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Build FluxDeluxe")
    parser.add_argument("--skip-installer", action="store_true",
                        help="Skip Inno Setup installer creation")
    parser.add_argument("--clean", action="store_true",
                        help="Wipe build/ and dist/ before building")
    args = parser.parse_args()

    if args.clean:
        _log("Cleaning build/ and dist/")
        for d in (BUILD, ROOT / "dist"):
            if d.exists():
                shutil.rmtree(d)
                print(f"  Removed {d}")

    sync_submodule()
    embedded_python = prepare_embedded_python()
    run_pyinstaller()
    assemble_dist(embedded_python)

    if not args.skip_installer:
        run_inno_setup()

    _log("BUILD COMPLETE")
    print(f"  Output: {DIST}")
    print(f"  To test: {DIST / 'FluxDeluxe.exe'}")


if __name__ == "__main__":
    main()
