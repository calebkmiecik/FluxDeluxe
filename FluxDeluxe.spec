# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for FluxDeluxe.

Build with:
    pyinstaller FluxDeluxe.spec

Or via the build script:
    python build.py
"""

import sys
from pathlib import Path

block_cipher = None

ROOT = Path(SPECPATH).resolve()
PKG = ROOT / "fluxdeluxe"

# ── Data files (bundled into _MEIPASS) ────────────────────────────────────
# Only assets that the *frozen Qt process itself* needs go here.
# DynamoDeluxe source and tools/ are copied alongside the exe by build.py.
datas = [
    (str(PKG / "ui" / "assets"), "ui/assets"),
    (str(PKG / "ui" / "theme.qss"), "ui"),
]

# ── Hidden imports ────────────────────────────────────────────────────────
# Packages that PyInstaller's analysis misses.
hiddenimports = [
    # Our own sub-packages
    "fluxdeluxe",
    "fluxdeluxe.runtime",
    "fluxdeluxe.updater",
    "fluxdeluxe.__version__",
    "fluxdeluxe.config",
    "fluxdeluxe.ui",
    "fluxdeluxe.ui.main_window",
    "fluxdeluxe.ui.dialogs.backend_log_dialog",
    "fluxdeluxe.ui.tools.launcher_page",
    "fluxdeluxe.ui.tools.tool_registry",
    "fluxdeluxe.ui.tools.web_tool_page",
    "fluxdeluxe.ui.tools.metrics_editor_page",
]

# ── Excludes (reduce bundle size) ─────────────────────────────────────────
excludes = [
    # Qt WebEngine (Chromium) — not used, saves ~340 MB
    "PySide6.QtWebEngineWidgets",
    "PySide6.QtWebEngineCore",
    "PySide6.QtWebChannel",
    # Unused Qt modules
    "PySide6.QtQuick",
    "PySide6.QtQuickWidgets",
    "PySide6.QtQml",
    "PySide6.Qt3DCore",
    "PySide6.Qt3DRender",
    "PySide6.QtPositioning",
    # Heavy libs not needed in frozen Qt app (backend has its own Python)
    "numpy",
    "pandas",
    "scipy",
    "pyarrow",
    "PIL",
    "openpyxl",
    "pyqtgraph",
    "firebase_admin",
    "google",
    "grpc",
    "cryptography",
    "setuptools",
    # Never needed
    "tkinter",
    "matplotlib",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
]

# ── Analysis ──────────────────────────────────────────────────────────────
a = Analysis(
    [str(ROOT / "run_app.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FluxDeluxe",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed app (no console window)
    # NOTE: Windows exe icons require .ico format. To add a custom icon,
    # convert fluxliteicon.svg to .ico and uncomment the line below:
    # icon=str(PKG / "ui" / "assets" / "icons" / "fluxliteicon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="FluxDeluxe",
)
