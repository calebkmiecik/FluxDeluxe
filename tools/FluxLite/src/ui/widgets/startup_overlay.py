from __future__ import annotations

from pathlib import Path

from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtCore import Qt

from ...connection_state import ConnectionStage


class StartupOverlay(QtWidgets.QWidget):
    """Full-page overlay shown during initial FluxLite connection.

    Draws the app icon centered with a spinning arc around it.
    The arc color reflects the real connection stage (amber = connecting,
    green = ready). On READY the arc fills to a full green ring, holds
    briefly, then the whole overlay fades out.  Once dismissed it never
    re-appears (reconnect feedback is status-bar only).

    Geometry is kept in sync with the parent via an event filter so the
    overlay always covers the full page regardless of when layout occurs.
    """

    # Layout
    ICON_SIZE = 180
    ARC_RADIUS = 116
    ARC_PEN_WIDTH = 5
    ARC_SPAN_DEG = 90

    # Timing
    SPIN_INTERVAL_MS = 25     # ~40 fps
    SPIN_STEP_DEG = 4
    FILL_STEP_DEG = 6

    # Colors
    COLOR_CONNECTING = QtGui.QColor("#FFB74D")
    COLOR_READY = QtGui.QColor("#4CAF50")
    COLOR_BG_CIRCLE = QtGui.QColor(24, 24, 28, 230)
    COLOR_BG_OVERLAY = QtGui.QColor(0, 0, 0, 100)

    def __init__(self, parent: QtWidgets.QWidget) -> None:
        super().__init__(parent)
        self.setAutoFillBackground(False)

        self._has_ever_been_ready = False
        self._filling = False   # arc expanding to 360° on READY

        # Arc state
        self._angle = 0.0
        self._span = float(self.ARC_SPAN_DEG)
        self._arc_color = QtGui.QColor(self.COLOR_CONNECTING)

        # Load icon
        self._icon = QtGui.QPixmap()
        try:
            icon_path = Path(__file__).resolve().parent.parent / "assets" / "icons" / "fluxliteicon.svg"
            pix = QtGui.QIcon(str(icon_path)).pixmap(self.ICON_SIZE, self.ICON_SIZE)
            if not pix.isNull():
                self._icon = pix
        except Exception:
            pass

        # Spin timer
        self._spin_timer = QtCore.QTimer(self)
        self._spin_timer.setInterval(self.SPIN_INTERVAL_MS)
        self._spin_timer.timeout.connect(self._tick)
        self._spin_timer.start()

        # Fade-out
        self._opacity = 1.0
        self._fade_timer = QtCore.QTimer(self)
        self._fade_timer.setInterval(20)
        self._fade_timer.timeout.connect(self._fade_tick)

        # Track parent resize so we always cover the full page.
        parent.installEventFilter(self)

    # ------------------------------------------------------------------
    # Parent size tracking
    # ------------------------------------------------------------------

    def eventFilter(self, obj: QtCore.QObject, event: QtCore.QEvent) -> bool:
        if obj is self.parent() and event.type() in (
            QtCore.QEvent.Type.Resize,
            QtCore.QEvent.Type.Show,
        ):
            self._match_parent()
        return False

    def _match_parent(self) -> None:
        p = self.parentWidget()
        if p is not None:
            self.setGeometry(0, 0, p.width(), p.height())
            self.raise_()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_stage(self, stage: ConnectionStage) -> None:
        """React to a connection stage change."""
        if self._has_ever_been_ready:
            return

        if stage == ConnectionStage.READY:
            self._has_ever_been_ready = True
            self._filling = True
            self._arc_color = QtGui.QColor(self.COLOR_READY)
            # _tick will handle the fill animation -> fade
        elif stage.is_connecting:
            self._arc_color = QtGui.QColor(self.COLOR_CONNECTING)
        elif stage == ConnectionStage.ERROR:
            self._arc_color = QtGui.QColor("#EF5350")

    # ------------------------------------------------------------------
    # Animation
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        if self._filling:
            self._span = min(self._span + self.FILL_STEP_DEG, 360.0)
            self._angle = (self._angle + self.SPIN_STEP_DEG * 0.5) % 360
            if self._span >= 360.0:
                self._filling = False
                self._spin_timer.stop()
                QtCore.QTimer.singleShot(350, self._start_fade)
        else:
            self._angle = (self._angle + self.SPIN_STEP_DEG) % 360
        self.update()

    def _start_fade(self) -> None:
        self._fade_timer.start()

    def _fade_tick(self) -> None:
        self._opacity -= 0.04
        if self._opacity <= 0:
            self._opacity = 0
            self._fade_timer.stop()
            self._spin_timer.stop()
            self.hide()
            return
        self.update()

    # ------------------------------------------------------------------
    # Painting
    # ------------------------------------------------------------------

    def paintEvent(self, event: QtGui.QPaintEvent) -> None:
        p = QtGui.QPainter(self)
        p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
        p.setOpacity(self._opacity)

        # Semi-transparent full-page backdrop
        p.fillRect(self.rect(), self.COLOR_BG_OVERLAY)

        cx = self.width() / 2
        cy = self.height() / 2

        # Dark circle behind the icon
        bg_r = self.ARC_RADIUS - self.ARC_PEN_WIDTH - 4
        p.setBrush(self.COLOR_BG_CIRCLE)
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(QtCore.QPointF(cx, cy), bg_r, bg_r)

        # Icon
        if not self._icon.isNull():
            ix = cx - self._icon.width() / 2
            iy = cy - self._icon.height() / 2
            p.drawPixmap(int(ix), int(iy), self._icon)

        # Arc
        pen = QtGui.QPen(self._arc_color, self.ARC_PEN_WIDTH)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)

        r = self.ARC_RADIUS
        arc_rect = QtCore.QRectF(cx - r, cy - r, 2 * r, 2 * r)
        start_16 = int((90 - self._angle) * 16)
        span_16 = int(-self._span * 16)
        p.drawArc(arc_rect, start_16, span_16)

        p.end()
