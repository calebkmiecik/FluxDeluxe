from __future__ import annotations

import collections
import configparser
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path

if __name__ == "__main__" and __package__ is None:
    package_root = Path(__file__).resolve().parent.parent
    if str(package_root) not in sys.path:
        sys.path.insert(0, str(package_root))
    __package__ = "fluxdeluxe"

# If this module is executed via `python -m fluxdeluxe.main`, it runs as `__main__`.
# Other parts of the app may later do `import fluxdeluxe.main`, which would otherwise
# create a second module instance with a different `_dynamo_process`. Alias the running
# module so imports see the same state.
if __name__ == "__main__":
    sys.modules.setdefault("fluxdeluxe.main", sys.modules[__name__])


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

_logger = logging.getLogger(__name__)


_dynamo_process: "subprocess.Popen[bytes] | None" = None
_backend_log_callbacks: list = []
_backend_log_buffer: collections.deque = collections.deque(maxlen=5000)
_drain_threads: list[threading.Thread] = []


def get_dynamo_process() -> "subprocess.Popen[bytes] | None":
    """Get the DynamoPy backend subprocess (for log viewing, etc.)."""
    return _dynamo_process


def register_backend_log_callback(cb) -> None:
    """Register a callback to receive backend log lines (str)."""
    _backend_log_callbacks.append(cb)


def unregister_backend_log_callback(cb) -> None:
    """Unregister a previously registered log callback."""
    try:
        _backend_log_callbacks.remove(cb)
    except ValueError:
        pass


def get_backend_log_buffer() -> collections.deque:
    """Get the buffer of recent backend log lines."""
    return _backend_log_buffer


def _drain_pipe(pipe, label: str) -> None:
    """Read from a subprocess pipe, dispatch to callbacks and buffer."""
    try:
        for line in iter(pipe.readline, b""):
            text = line.decode("utf-8", errors="replace")
            _backend_log_buffer.append(text)
            for cb in _backend_log_callbacks[:]:
                try:
                    cb(text)
                except Exception:
                    pass
    except Exception:
        pass
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def _get_dynamo_path() -> Path:
    """Return the path to the DynamoPy submodule."""
    from .runtime import is_frozen, get_app_dir

    if is_frozen():
        # In the frozen app, DynamoPy is at <install_dir>/fluxdeluxe/DynamoPy
        base = get_app_dir() / "fluxdeluxe" / "DynamoPy"
    else:
        base = Path(__file__).resolve().parent / "DynamoPy"

    if (base / "app" / "main.py").exists():
        return base

    # Handle nested submodule layouts like DynamoPy/AxioforceDynamoPy/...
    if base.exists():
        for child in base.iterdir():
            if child.is_dir() and (child / "app" / "main.py").exists():
                return child

    return base


def _get_dynamo_tracking_branch() -> str:
    """Return the configured tracking branch for the DynamoPy submodule.

    Falls back to "main" if configuration can't be determined.
    """
    repo_root = Path(__file__).resolve().parent.parent
    gitmodules_path = repo_root / ".gitmodules"
    if not gitmodules_path.exists():
        return "main"

    try:
        cfg = configparser.RawConfigParser()
        cfg.read(gitmodules_path, encoding="utf-8")
        for section in cfg.sections():
            sub_path = cfg.get(section, "path", fallback="")
            if sub_path.replace("\\", "/").lower().endswith("dynamopy"):
                branch = cfg.get(section, "branch", fallback="main").strip()
                return branch or "main"
    except Exception:
        # Keep startup resilient if parsing fails.
        return "main"

    return "main"


def _git_run(args: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )


def _update_dynamo_deluxe() -> None:
    """Check for and pull the latest DynamoPy submodule if updates are available."""
    submodule_path = _get_dynamo_path()
    if not submodule_path.exists():
        _logger.warning("DynamoPy submodule not found at %s", submodule_path)
        return

    try:
        branch = _get_dynamo_tracking_branch()

        status = _git_run(["status", "--porcelain"], cwd=submodule_path)
        if status.stdout.strip():
            _logger.warning("DynamoPy has local changes; skipping auto-update (branch=%s).", branch)
            return

        # Fetch latest from remote
        _git_run(["fetch", "origin", branch], cwd=submodule_path)

        # Ensure we are on the configured branch so pulls work even if detached.
        current_branch = _git_run(["rev-parse", "--abbrev-ref", "HEAD"], cwd=submodule_path).stdout.strip()
        if current_branch != branch:
            try:
                _git_run(["checkout", branch], cwd=submodule_path)
            except subprocess.CalledProcessError:
                _git_run(["checkout", "-B", branch, f"origin/{branch}"], cwd=submodule_path)

        # Check if we're behind
        result = _git_run(["rev-list", "--count", f"HEAD..origin/{branch}"], cwd=submodule_path)
        commits_behind = int(result.stdout.strip() or "0")

        if commits_behind > 0:
            _logger.info("DynamoPy is %d commit(s) behind. Pulling updates...", commits_behind)
            _git_run(["pull", "origin", branch], cwd=submodule_path)
            _logger.info("DynamoPy updated successfully.")
        else:
            _logger.info("DynamoPy is up to date.")

    except subprocess.CalledProcessError as exc:
        _logger.warning("Failed to update DynamoPy: %s", exc)
    except Exception as exc:
        _logger.warning("Unexpected error updating DynamoPy: %s", exc)


def _start_dynamo_backend() -> None:
    """Start the DynamoPy backend as a subprocess."""
    from .runtime import get_python_executable

    global _dynamo_process

    dynamo_path = _get_dynamo_path()
    if not dynamo_path.exists():
        _logger.warning("DynamoPy not found, skipping backend startup")
        return

    main_script = dynamo_path / "app" / "main.py"
    if not main_script.exists():
        _logger.warning("DynamoPy main.py not found at %s", main_script)
        return

    python_exe = get_python_executable()

    # Set up environment matching the PyCharm run configuration
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["APP_ENV"] = "development"

    # Add DynamoPy root to PYTHONPATH so "app.main" imports work
    pythonpath_parts = [str(dynamo_path)]
    if env.get("PYTHONPATH"):
        pythonpath_parts.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)

    # Working directory should be the "app" subfolder
    # so that relative paths like "../file_system" resolve correctly
    working_dir = dynamo_path / "app"

    try:
        _logger.info("Starting DynamoPy backend...")
        _logger.info("  Python: %s", python_exe)
        _logger.info("  Script: %s", main_script)
        _logger.info("  Working directory: %s", working_dir)
        _logger.info("  PYTHONPATH: %s", env["PYTHONPATH"])
        popen_kwargs = dict(
            cwd=working_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        _dynamo_process = subprocess.Popen(
            [python_exe, str(main_script)], **popen_kwargs
        )
        _logger.info("DynamoPy backend started (PID: %d)", _dynamo_process.pid)

        # Check if process died immediately
        import time
        time.sleep(0.5)
        poll_result = _dynamo_process.poll()
        if poll_result is not None:
            _logger.error("DynamoPy backend exited immediately with code: %d", poll_result)
            # Try to read any error output
            stdout_data, stderr_data = _dynamo_process.communicate(timeout=2)
            if stdout_data:
                _logger.error("stdout: %s", stdout_data.decode("utf-8", errors="replace")[:2000])
            if stderr_data:
                _logger.error("stderr: %s", stderr_data.decode("utf-8", errors="replace")[:2000])
            _dynamo_process = None
        else:
            _logger.info("DynamoPy backend is running")
            # Start drain threads to read stdout/stderr and prevent pipe deadlock
            global _drain_threads
            _drain_threads = []
            if _dynamo_process.stdout:
                t = threading.Thread(
                    target=_drain_pipe,
                    args=(_dynamo_process.stdout, "stdout"),
                    daemon=True,
                )
                t.start()
                _drain_threads.append(t)
            if _dynamo_process.stderr:
                t = threading.Thread(
                    target=_drain_pipe,
                    args=(_dynamo_process.stderr, "stderr"),
                    daemon=True,
                )
                t.start()
                _drain_threads.append(t)
    except Exception as exc:
        _logger.error("Failed to start DynamoPy backend: %s", exc)
        import traceback
        _logger.error(traceback.format_exc())


def _stop_dynamo_backend() -> None:
    """Stop the DynamoPy backend subprocess gracefully."""
    global _dynamo_process

    if _dynamo_process is None:
        return

    try:
        _logger.info("Stopping DynamoPy backend (PID: %d)...", _dynamo_process.pid)

        # Try graceful shutdown via API first
        try:
            import requests
            _logger.info("Attempting graceful shutdown via API...")
            requests.post("http://localhost:3001/api/shutdown", timeout=5)
            _dynamo_process.wait(timeout=10)
            _logger.info("DynamoPy backend stopped gracefully.")
            return
        except Exception as api_exc:
            _logger.warning("Graceful shutdown failed (%s), terminating process...", api_exc)

        # Fallback to terminate
        _dynamo_process.terminate()
        _dynamo_process.wait(timeout=10)
        _logger.info("DynamoPy backend stopped.")
    except subprocess.TimeoutExpired:
        _logger.warning("DynamoPy backend did not stop gracefully, killing...")
        _dynamo_process.kill()
        _dynamo_process.wait()
    except Exception as exc:
        _logger.error("Error stopping DynamoPy backend: %s", exc)
    finally:
        _dynamo_process = None


def stop_dynamo_backend() -> None:
    """Public wrapper to stop the DynamoPy backend."""
    _stop_dynamo_backend()


def start_dynamo_backend() -> None:
    """Public wrapper to start the DynamoPy backend."""
    _start_dynamo_backend()


def run_qt() -> int:
    from .runtime import is_frozen, get_app_dir, resource_path

    # In frozen mode, add the install dir to sys.path so tools/ is importable
    if is_frozen():
        app_dir = str(get_app_dir())
        if app_dir not in sys.path:
            sys.path.insert(0, app_dir)

    # Windows taskbar icon grouping is tied to an AppUserModelID.
    try:
        if sys.platform.startswith("win"):
            import ctypes  # noqa: WPS433

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Axioforce.AxioforceFluxDeluxe")
    except Exception:
        pass

    from PySide6 import QtGui, QtWidgets  # type: ignore
    from PySide6 import QtCore  # type: ignore
    from PySide6.QtCore import Qt  # type: ignore

    from .ui.main_window import MainWindow

    app = QtWidgets.QApplication(sys.argv)

    # App/window icon
    try:
        icon_path = resource_path("ui", "assets", "icons", "fluxliteicon.svg")
        icon = QtGui.QIcon(str(icon_path))
        if not icon.isNull():
            app.setWindowIcon(icon)
    except Exception:
        pass

    # Splash screen while app + backend come up.
    splash = None
    try:
        icon_path = resource_path("ui", "assets", "icons", "fluxliteicon.svg")
        pix = QtGui.QIcon(str(icon_path)).pixmap(256, 256)
        if not pix.isNull():
            splash = QtWidgets.QSplashScreen(pix)
            splash.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
            splash.setEnabled(False)
            splash.show()
            app.processEvents()
    except Exception:
        splash = None

    # Global theme (QSS). Rewrite url("assets/...") to absolute paths so icons work reliably.
    try:
        import re

        qss_path = resource_path("ui", "theme.qss")
        qss_text = qss_path.read_text(encoding="utf-8")
        ui_dir = qss_path.parent

        def _abs_url(m: "re.Match[str]") -> str:
            rel = m.group("rel")
            abs_path = (ui_dir / rel).resolve().as_posix()
            return f'url("{abs_path}")'

        qss_text = re.sub(
            r"url\(\s*(?P<q>['\"]?)(?P<rel>assets/[^)\"']+)(?P=q)\s*\)",
            _abs_url,
            qss_text,
        )
        app.setStyleSheet(qss_text)
    except Exception as exc:
        logging.getLogger(__name__).warning("Failed to load Qt theme.qss: %s", exc)

    win = MainWindow()
    win.showMaximized()

    # Close splash once backend is detected (or after a short timeout).
    if splash is not None:
        try:
            max_ms = 6000
            interval_ms = 100
            elapsed_ms = 0

            def _tick() -> None:
                nonlocal elapsed_ms
                elapsed_ms += interval_ms
                try:
                    if win.is_backend_ready() or elapsed_ms >= max_ms:
                        splash.finish(win)
                        splash.deleteLater()
                        return
                except Exception:
                    splash.finish(win)
                    splash.deleteLater()
                    return
                QtCore.QTimer.singleShot(interval_ms, _tick)

            QtCore.QTimer.singleShot(interval_ms, _tick)
        except Exception:
            try:
                splash.finish(win)
                splash.deleteLater()
            except Exception:
                pass

    rc = app.exec()
    return int(rc)


def main() -> int:
    from .runtime import is_frozen

    # In packaged builds, skip submodule git operations at startup.
    # Keep current auto-update behavior in development mode.
    if is_frozen():
        _logger.info("Frozen build detected; skipping DynamoPy git auto-update.")
    else:
        # Check for DynamoPy updates before starting the app
        _update_dynamo_deluxe()

    # Start the DynamoPy backend
    _start_dynamo_backend()

    # Qt is required; raise a clear error if unavailable
    try:
        import PySide6  # noqa: F401
    except Exception as exc:
        raise RuntimeError("PySide6 is required.") from exc

    try:
        return run_qt()
    finally:
        # Ensure backend is stopped when the Qt app exits
        _stop_dynamo_backend()


if __name__ == "__main__":
    raise SystemExit(main())

