from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

from PySide6 import QtCore, QtGui, QtWidgets

from .tool_registry import ToolSpec


class _ToolRow(QtWidgets.QFrame):
    """A single clickable row in the tool list."""

    clicked = QtCore.Signal()

    def __init__(self, tool: ToolSpec, parent: QtWidgets.QWidget | None = None) -> None:
        super().__init__(parent)
        self.setCursor(QtCore.Qt.PointingHandCursor)
        self.setObjectName("toolRow")
        self.setStyleSheet(
            "#toolRow {"
            "  background: #1A1A1A;"
            "  border: 1px solid rgba(224, 224, 224, 25);"
            "  border-radius: 8px;"
            "  padding: 12px 16px;"
            "}"
            "#toolRow:hover {"
            "  border: 1px solid rgba(224, 224, 224, 60);"
            "  background: #1E1E1E;"
            "}"
        )

        row = QtWidgets.QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(12)

        # Left: text block (name + description)
        text_col = QtWidgets.QVBoxLayout()
        text_col.setSpacing(2)

        name_lbl = QtWidgets.QLabel(tool.name)
        f = name_lbl.font()
        f.setPointSize(12)
        f.setBold(True)
        name_lbl.setFont(f)
        name_lbl.setStyleSheet("color: #E0E0E0; background: transparent; border: none;")
        text_col.addWidget(name_lbl)

        if tool.description:
            desc_lbl = QtWidgets.QLabel(tool.description)
            desc_lbl.setStyleSheet("color: #888; background: transparent; border: none;")
            desc_lbl.setWordWrap(True)
            text_col.addWidget(desc_lbl)

        row.addLayout(text_col, 1)

        # Right: browser icon for web / streamlit tools
        if tool.kind in ("web", "streamlit"):
            icon_lbl = QtWidgets.QLabel()
            icon_lbl.setFixedSize(22, 22)
            icon_lbl.setStyleSheet("background: transparent; border: none;")
            icon_lbl.setToolTip("Opens in browser")
            # Draw a simple globe icon via SVG
            svg_data = (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
                'fill="none" stroke="#888" stroke-width="1.8" '
                'stroke-linecap="round" stroke-linejoin="round">'
                '<circle cx="12" cy="12" r="10"/>'
                '<ellipse cx="12" cy="12" rx="4" ry="10"/>'
                '<line x1="2" y1="12" x2="22" y2="12"/>'
                '</svg>'
            )
            pm = QtGui.QPixmap(22, 22)
            pm.fill(QtCore.Qt.transparent)
            try:
                from PySide6 import QtSvg
                renderer = QtSvg.QSvgRenderer(QtCore.QByteArray(svg_data.encode()))
                if renderer.isValid():
                    painter = QtGui.QPainter(pm)
                    renderer.render(painter)
                    painter.end()
                    icon_lbl.setPixmap(pm)
            except Exception:
                pass
            row.addWidget(icon_lbl, 0, QtCore.Qt.AlignVCenter)

    def mousePressEvent(self, event: QtGui.QMouseEvent) -> None:
        if event.button() == QtCore.Qt.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)


class ToolLauncherPage(QtWidgets.QWidget):
    tool_selected = QtCore.Signal(str)  # tool_id

    def __init__(self, tools: Iterable[ToolSpec], parent: QtWidgets.QWidget | None = None) -> None:
        super().__init__(parent)
        self._tools = list(tools)
        self._setup_ui()

    def _setup_ui(self) -> None:
        page = QtWidgets.QVBoxLayout(self)
        page.setContentsMargins(18, 18, 18, 18)
        page.setSpacing(0)

        # Logo pinned to top-left
        logo_path = self._resolve_logo_path()
        if logo_path is not None:
            logo = self._build_logo_widget(logo_path)
            if logo is not None:
                page.addWidget(logo)
                page.addSpacing(12)

        # Vertically center the tool list
        page.addStretch(15)

        h_row = QtWidgets.QHBoxLayout()
        h_row.addStretch(25)

        # Narrow centered tool list
        center = QtWidgets.QVBoxLayout()
        center.setSpacing(10)

        for tool in self._tools:
            row = _ToolRow(tool)
            row.clicked.connect(lambda tid=tool.tool_id: self.tool_selected.emit(tid))
            center.addWidget(row)

        h_row.addLayout(center, 50)
        h_row.addStretch(25)

        page.addLayout(h_row)
        page.addStretch(20)

    def _build_logo_widget(self, path: Path) -> QtWidgets.QWidget | None:
        max_w = 210
        max_h = 55

        pm = self._render_logo_pixmap(path, max_w=max_w, max_h=max_h)
        if pm is None or pm.isNull():
            return None

        lbl = QtWidgets.QLabel()
        lbl.setAlignment(QtCore.Qt.AlignLeft | QtCore.Qt.AlignVCenter)
        lbl.setSizePolicy(QtWidgets.QSizePolicy.Fixed, QtWidgets.QSizePolicy.Fixed)
        lbl.setPixmap(pm)

        wrap = QtWidgets.QWidget()
        row = QtWidgets.QHBoxLayout(wrap)
        row.setContentsMargins(0, 0, 0, 0)
        row.addWidget(lbl, 0, QtCore.Qt.AlignLeft | QtCore.Qt.AlignTop)
        row.addStretch(1)
        return wrap

    def _render_logo_pixmap(self, path: Path, *, max_w: int, max_h: int) -> QtGui.QPixmap | None:
        suffix = path.suffix.lower()
        dpr = 1.0
        try:
            dpr = float(self.devicePixelRatioF())
        except Exception:
            dpr = 1.0

        if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            pm = QtGui.QPixmap(str(path))
            if pm.isNull():
                return None
            scaled = pm.scaled(
                int(max_w * dpr),
                int(max_h * dpr),
                QtCore.Qt.KeepAspectRatio,
                QtCore.Qt.SmoothTransformation,
            )
            scaled.setDevicePixelRatio(dpr)
            return scaled

        if suffix == ".svg":
            try:
                from PySide6 import QtSvg  # type: ignore
            except Exception:
                return None

            renderer = QtSvg.QSvgRenderer(str(path))
            if not renderer.isValid():
                return None

            default = renderer.defaultSize()
            w0 = int(default.width()) if default.width() > 0 else max_w
            h0 = int(default.height()) if default.height() > 0 else max_h
            if w0 <= 0 or h0 <= 0:
                w0, h0 = max_w, max_h

            scale = min(max_w / float(w0), max_h / float(h0), 1.0)
            w = max(1, int(w0 * scale))
            h = max(1, int(h0 * scale))

            render_dpr = max(dpr, 3.0)

            img = QtGui.QImage(
                int(w * render_dpr),
                int(h * render_dpr),
                QtGui.QImage.Format_ARGB32_Premultiplied,
            )
            img.fill(QtCore.Qt.transparent)

            p = QtGui.QPainter(img)
            try:
                p.setRenderHint(QtGui.QPainter.Antialiasing, True)
                p.setRenderHint(QtGui.QPainter.TextAntialiasing, True)
                p.setRenderHint(QtGui.QPainter.SmoothPixmapTransform, True)
                renderer.render(p, QtCore.QRectF(0.0, 0.0, float(img.width()), float(img.height())))
            finally:
                p.end()

            pm = QtGui.QPixmap.fromImage(img)
            pm.setDevicePixelRatio(render_dpr)
            return pm

        return None

    def _resolve_logo_path(self) -> Path | None:
        from ...runtime import get_bundle_dir
        ui_dir = get_bundle_dir() / "ui"
        candidate_logos = ui_dir / "assets" / "logos" / "FluxDeluxeLogo.png"
        if candidate_logos.exists():
            return candidate_logos
        candidate_logos = ui_dir / "assets" / "logos" / "FluxDeluxeLogo.svg"
        if candidate_logos.exists():
            return candidate_logos
        candidate_logo = ui_dir / "assets" / "logo" / "FluxDeluxeLogo.svg"
        if candidate_logo.exists():
            return candidate_logo
        candidate_icons = ui_dir / "assets" / "icons" / "FluxDeluxeLogo.svg"
        if candidate_icons.exists():
            return candidate_icons

        env_path = str(os.environ.get("FLUXDELUXE_LOGO_SVG", "") or "").strip()
        if env_path:
            p = Path(env_path)
            if p.exists():
                return p

        return None
