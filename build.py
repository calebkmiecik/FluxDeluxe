"""Build script for FluxDeluxe.

Automates the full build pipeline:
  1. Sync the DynamoPy git submodule
  2. Download / prepare an embedded Python (for backend subprocesses)
  3. Run PyInstaller to freeze the Qt app
  4. Assemble the final dist folder (copy DynamoPy, tools, embedded Python)
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
import ast
import io
import os
import re
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
    _log("Step 1: Syncing DynamoPy submodule")
    dynamo_dir = ROOT / "fluxdeluxe" / "DynamoPy"
    dynamo_main = dynamo_dir / "app" / "main.py"

    # If DynamoPy already has content, just update it
    if dynamo_main.exists():
        print("  DynamoPy already present, updating...")
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
                "git", "clone", "--branch", "main", "--single-branch",
                "https://github.com/Axioforce/AxioforceDynamoPy.git",
                str(dynamo_dir),
            ])

    # Regardless of how we got here, make sure we're on the latest dev
    if dynamo_main.exists():
        try:
            _run(["git", "fetch", "origin", "main"], cwd=str(dynamo_dir))
            _run(["git", "checkout", "main"], cwd=str(dynamo_dir))
            _run(["git", "pull", "origin", "main"], cwd=str(dynamo_dir))
            print("  DynamoPy is on latest dev.")
        except subprocess.CalledProcessError as exc:
            print(f"  WARNING: Could not update DynamoPy to latest dev: {exc}")
    else:
        print("  WARNING: DynamoPy app/main.py not found after sync.")


# ── Step 2: Embedded Python ──────────────────────────────────────────────


def _parse_required_packages() -> set[str]:
    """Parse package names from requirements_backend.txt (normalised to lowercase)."""
    required: set[str] = set()
    for line in BACKEND_REQS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Strip version specifiers: "foo>=1.0" -> "foo", "foo[extra]>=1" -> "foo"
        name = re.split(r"[>=<!\[;]", line, maxsplit=1)[0].strip()
        if name:
            required.add(name.lower().replace("-", "_"))
    return required


# Packages that pip installs as infrastructure / build-time deps and should
# never be uninstalled from the embedded Python.
_PIP_INFRASTRUCTURE = {
    "pip", "setuptools", "wheel", "pkg_resources",
}


def _clean_stale_packages(python_exe: Path) -> None:
    """Remove installed packages that are NOT in requirements_backend.txt
    and NOT depended on by any required package.

    This catches leftover packages from a previously-removed requirement
    (e.g. pyqtgraph pulling in jaraco.* dependencies).
    """
    required = _parse_required_packages()
    # Keep tflite-runtime if present (bundled with tensorflow)
    required.add("tflite_runtime")

    # Get list of installed packages via pip freeze
    result = subprocess.run(
        [str(python_exe), "-m", "pip", "freeze"],
        capture_output=True, text=True,
    )
    installed: dict[str, str] = {}  # normalised name -> original line
    for line in result.stdout.strip().splitlines():
        if "==" in line:
            raw_name = line.split("==")[0]
            normalised = raw_name.lower().replace("-", "_")
            installed[normalised] = raw_name

    # Find candidates: packages not in requirements and not pip infrastructure
    candidates = []
    for norm_name, raw_name in installed.items():
        if norm_name in _PIP_INFRASTRUCTURE:
            continue
        if norm_name in required:
            continue
        # Check if it's a sub-package of a required package (e.g. google_*)
        if any(norm_name.startswith(r + "_") or norm_name.startswith(r + ".")
               for r in required):
            continue
        candidates.append((norm_name, raw_name))

    if not candidates:
        print("  No stale packages detected.")
        return

    # For each candidate, check if it's a dependency of a required package.
    # Only remove truly orphaned packages.
    stale = []
    for norm_name, raw_name in candidates:
        show = subprocess.run(
            [str(python_exe), "-m", "pip", "show", raw_name],
            capture_output=True, text=True,
        )
        required_by = ""
        for show_line in show.stdout.splitlines():
            if show_line.startswith("Required-by:"):
                required_by = show_line.split(":", 1)[1].strip()
                break
        if not required_by:
            # No package depends on this — it's truly orphaned
            stale.append(raw_name)

    if not stale:
        print("  No stale packages to remove.")
        return

    print(f"  Removing {len(stale)} stale package(s) from embedded Python:")
    for pkg in stale:
        print(f"    - {pkg}")
    _run([
        str(python_exe), "-m", "pip", "uninstall", "-y", *stale,
    ])


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

    # Clean stale packages that are no longer in requirements_backend.txt.
    # This prevents leftover packages (e.g. from a removed requirement)
    # from contaminating the embedded Python across builds.
    _clean_stale_packages(python_exe)

    # Install backend dependencies
    print("  Installing backend dependencies ...")
    _run([
        str(python_exe), "-m", "pip", "install",
        "--no-warn-script-location",
        "-r", str(BACKEND_REQS),
    ])

    # Note: tflite-runtime is no longer installed separately.
    # Full TensorFlow (from requirements_backend.txt) includes TF Lite support.

    # Verify DynamoPy imports are all available
    verify_backend_imports(python_exe)

    return target


# ── Step 2b: Verify imports ─────────────────────────────────────────────

# Standard library module names (Python 3.11) — used to skip stdlib imports
_STDLIB = {
    "abc", "aifc", "argparse", "array", "ast", "asynchat", "asyncio",
    "asyncore", "atexit", "audioop", "base64", "bdb", "binascii", "binhex",
    "bisect", "builtins", "bz2", "calendar", "cgi", "cgitb", "chunk",
    "cmath", "cmd", "code", "codecs", "codeop", "collections", "colorsys",
    "compileall", "concurrent", "configparser", "contextlib", "contextvars",
    "copy", "copyreg", "cProfile", "crypt", "csv", "ctypes", "curses",
    "dataclasses", "datetime", "dbm", "decimal", "difflib", "dis",
    "distutils", "doctest", "email", "encodings", "enum", "errno",
    "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "fractions",
    "ftplib", "functools", "gc", "getopt", "getpass", "gettext", "glob",
    "grp", "gzip", "hashlib", "heapq", "hmac", "html", "http", "idlelib",
    "imaplib", "imghdr", "imp", "importlib", "inspect", "io", "ipaddress",
    "itertools", "json", "keyword", "lib2to3", "linecache", "locale",
    "logging", "lzma", "mailbox", "mailcap", "marshal", "math", "mimetypes",
    "mmap", "modulefinder", "msvcrt", "multiprocessing", "netrc", "nis",
    "nntplib", "numbers", "operator", "optparse", "os", "ossaudiodev",
    "pathlib", "pdb", "pickle", "pickletools", "pipes", "pkgutil",
    "platform", "plistlib", "poplib", "posix", "posixpath", "pprint",
    "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr",
    "pydoc", "queue", "quopri", "random", "re", "readline", "reprlib",
    "resource", "rlcompleter", "runpy", "sched", "secrets", "select",
    "selectors", "shelve", "shlex", "shutil", "signal", "site", "smtpd",
    "smtplib", "sndhdr", "socket", "socketserver", "spwd", "sqlite3",
    "sre_compile", "sre_constants", "sre_parse", "ssl", "stat",
    "statistics", "string", "stringprep", "struct", "subprocess",
    "sunau", "symtable", "sys", "sysconfig", "syslog", "tabnanny",
    "tarfile", "telnetlib", "tempfile", "termios", "test", "textwrap",
    "threading", "time", "timeit", "tkinter", "token", "tokenize",
    "tomllib", "trace", "traceback", "tracemalloc", "tty", "turtle",
    "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib",
    "uu", "uuid", "venv", "warnings", "wave", "weakref", "webbrowser",
    "winreg", "winsound", "wsgiref", "xdrlib", "xml", "xmlrpc",
    "zipapp", "zipfile", "zipimport", "zlib",
    # Private / internal
    "_thread", "__future__", "_abc", "_io",
}

# Imports that are known to be OK even though they won't be in site-packages
# (e.g. local DynamoPy imports, build-only deps, test-only deps)
_IGNORE_IMPORTS = {
    "app",              # DynamoPy local package
    "PyInstaller",      # build-time only
    "PyQt5",            # test scripts only
    "pyqtgraph",        # UI-side dependency; not required in embedded backend import check
    # tensorflow is now a real backend dependency — installed via requirements_backend.txt
    "win32api",         # pywin32 — only used in legacy/optional paths
    "win32com",         # pywin32
    "category_editor",  # DynamoPy local tool
    "script_editor",    # DynamoPy local tool
    "sklearn",          # standalone research script (copRegressionModel.py), not runtime
    "_ctypes",          # CPython internal C extension
}


def _scan_imports(source_dir: Path) -> set[str]:
    """Scan Python files for top-level import package names using AST."""
    packages: set[str] = set()
    for py_file in source_dir.rglob("*.py"):
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    packages.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom) and node.module:
                packages.add(node.module.split(".")[0])
    return packages


def _find_local_packages(source_dir: Path) -> set[str]:
    """Discover all package/module names local to a source tree.

    Walks every directory that contains at least one .py file and collects
    directory names and bare .py file stems at every level.  This catches
    both ``from app.device import …`` and ``from device import …`` styles.
    """
    local: set[str] = set()
    for path in source_dir.rglob("*.py"):
        # The file's stem (e.g. loop.py → "loop")
        local.add(path.stem)
        # Every ancestor directory up to (but not including) source_dir
        rel = path.relative_to(source_dir)
        for part in rel.parts[:-1]:          # directories only
            local.add(part)
    return local


def verify_backend_imports(python_exe: Path) -> None:
    """Check that every third-party import in DynamoPy is importable."""
    _log("Step 2b: Verifying backend imports")
    dynamo_dir = ROOT / "fluxdeluxe" / "DynamoPy"
    if not dynamo_dir.exists():
        print("  DynamoPy not found, skipping import check.")
        return

    all_imports = _scan_imports(dynamo_dir)
    local_packages = _find_local_packages(dynamo_dir)

    # Filter to third-party only
    third_party = sorted(
        pkg for pkg in all_imports
        if pkg not in _STDLIB and pkg not in _IGNORE_IMPORTS
        and pkg not in local_packages
    )

    print(f"  Found {len(third_party)} third-party packages to verify:")
    print(f"    {', '.join(third_party)}")

    # Ask the embedded Python to try importing each one
    check_script = "; ".join(
        f"__import__('{pkg}') and None" for pkg in third_party
    )
    # Build a script that reports pass/fail per package
    lines = [
        "import importlib, sys",
        "missing = []",
    ]
    for pkg in third_party:
        lines.append(
            f"try:\n importlib.import_module('{pkg}')\n"
            f"except ImportError:\n missing.append('{pkg}')"
        )
    lines.append("if missing:")
    lines.append(" print('MISSING: ' + ', '.join(missing), file=sys.stderr)")
    lines.append(" sys.exit(1)")
    lines.append("else:")
    lines.append(f" print('  All {len(third_party)} packages verified OK')")

    script = "\n".join(lines)
    result = subprocess.run(
        [str(python_exe), "-c", script],
        capture_output=True, text=True,
    )
    print(result.stdout.strip())
    if result.returncode != 0:
        missing_str = result.stderr.strip()
        print(f"\n  ERROR: {missing_str}")
        print("  Add missing packages to requirements_backend.txt and re-run.")
        sys.exit(1)


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

    # Strip TensorFlow C++ headers — not needed at runtime and the
    # extremely deep paths break Inno Setup (Windows MAX_PATH).
    tf_include = site_packages / "tensorflow" / "include"
    if tf_include.is_dir():
        size = sum(f.stat().st_size for f in tf_include.rglob("*") if f.is_file())
        shutil.rmtree(tf_include)
        print(f"  Stripped tensorflow/include: {size / 1024 / 1024:.1f} MB")

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

    # Add sitecustomize.py so the embedded Python respects PYTHONPATH.
    # The ._pth file disables PYTHONPATH by default in embeddable distributions.
    sitecustomize = dest_python / "sitecustomize.py"
    sitecustomize.write_text(
        "import os, sys\n"
        "for p in os.environ.get('PYTHONPATH', '').split(os.pathsep):\n"
        "    if p and p not in sys.path:\n"
        "        sys.path.insert(0, p)\n",
        encoding="utf-8",
    )
    print("  Added sitecustomize.py for PYTHONPATH support")

    # Copy DynamoPy source (submodule)
    src_dynamo = ROOT / "fluxdeluxe" / "DynamoPy"
    dest_dynamo = DIST / "fluxdeluxe" / "DynamoPy"
    if src_dynamo.exists():
        if dest_dynamo.exists():
            shutil.rmtree(dest_dynamo)
        print(f"  Copying DynamoPy -> {dest_dynamo}")
        shutil.copytree(
            src_dynamo, dest_dynamo,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"),
        )
    else:
        print("  WARNING: DynamoPy submodule not found — skipping")

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
