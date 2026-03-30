"""Entry point for PyInstaller-frozen FluxDeluxe."""
import sys


def _run_electron() -> int:
    """Launch the Electron shell (does NOT start DynamoPy; Electron owns that lifecycle)."""
    import subprocess
    from pathlib import Path

    electron_dir = Path(__file__).resolve().parent.parent / "electron-app"
    if not (electron_dir / "package.json").exists():
        print(f"ERROR: electron-app/ not found at {electron_dir}", file=sys.stderr)
        return 1
    print(f"Starting Electron shell from {electron_dir} ...")
    result = subprocess.run(["npm", "run", "dev"], cwd=str(electron_dir), shell=True)
    return result.returncode


if "--electron" in sys.argv:
    raise SystemExit(_run_electron())

from fluxdeluxe.main import main

raise SystemExit(main())
