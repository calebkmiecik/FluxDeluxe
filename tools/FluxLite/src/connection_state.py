from __future__ import annotations

import enum
import threading
from typing import Callable, Optional

from PySide6 import QtCore


class ConnectionStage(enum.Enum):
    """Typed stages for the backend connection lifecycle."""

    BACKEND_STARTING = "backend_starting"
    SOCKET_CONNECTING = "socket_connecting"
    DISCOVERING_DEVICES = "discovering_devices"
    READY = "ready"
    DISCONNECTED = "disconnected"
    ERROR = "error"

    @property
    def label(self) -> str:
        _labels = {
            ConnectionStage.BACKEND_STARTING: "Starting backend\u2026",
            ConnectionStage.SOCKET_CONNECTING: "Connecting\u2026",
            ConnectionStage.DISCOVERING_DEVICES: "Discovering devices\u2026",
            ConnectionStage.READY: "Connected",
            ConnectionStage.DISCONNECTED: "Disconnected",
            ConnectionStage.ERROR: "Error",
        }
        return _labels.get(self, self.value)

    @property
    def is_connecting(self) -> bool:
        return self in (
            ConnectionStage.BACKEND_STARTING,
            ConnectionStage.SOCKET_CONNECTING,
            ConnectionStage.DISCOVERING_DEVICES,
        )

    @property
    def dot_color(self) -> str:
        _colors = {
            ConnectionStage.BACKEND_STARTING: "#FFB74D",
            ConnectionStage.SOCKET_CONNECTING: "#FFB74D",
            ConnectionStage.DISCOVERING_DEVICES: "#FFB74D",
            ConnectionStage.READY: "#4CAF50",
            ConnectionStage.DISCONNECTED: "#BDBDBD",
            ConnectionStage.ERROR: "#EF5350",
        }
        return _colors.get(self, "#BDBDBD")


class ConnectionStateMachine(QtCore.QObject):
    """
    Manages connection stage transitions and emits typed signals.

    Thread-safe: ``set_stage`` can be called from any thread and will
    marshal the actual state change to the Qt (GUI) thread via a
    queued-callable pattern (same as HardwareService._post_to_qt).
    """

    stage_changed = QtCore.Signal(object)       # ConnectionStage
    status_text_changed = QtCore.Signal(str)     # Human-readable status string

    def __init__(self, parent: QtCore.QObject | None = None) -> None:
        super().__init__(parent)
        self._stage: ConnectionStage = ConnectionStage.BACKEND_STARTING
        self._detail: str = ""

        # Cross-thread queue (mirrors HardwareService._post_to_qt pattern)
        self._qt_call_lock = threading.Lock()
        self._qt_call_queue: list[Callable[[], None]] = []

        # Timer for discovery timeout (3s)
        self._discovery_timer = QtCore.QTimer(self)
        self._discovery_timer.setSingleShot(True)
        self._discovery_timer.setInterval(3000)
        self._discovery_timer.timeout.connect(self._on_discovery_timeout)

    @property
    def stage(self) -> ConnectionStage:
        return self._stage

    # ------------------------------------------------------------------
    # Thread-safe queue (same pattern as HardwareService._post_to_qt)
    # ------------------------------------------------------------------

    @QtCore.Slot()
    def _drain_queue(self) -> None:
        while True:
            fn: Optional[Callable[[], None]] = None
            with self._qt_call_lock:
                if self._qt_call_queue:
                    fn = self._qt_call_queue.pop(0)
            if fn is None:
                return
            try:
                fn()
            except Exception:
                pass

    def _post_to_qt(self, fn: Callable[[], None]) -> None:
        try:
            with self._qt_call_lock:
                self._qt_call_queue.append(fn)
            QtCore.QMetaObject.invokeMethod(self, "_drain_queue", QtCore.Qt.QueuedConnection)
        except Exception:
            try:
                fn()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_stage(self, stage: ConnectionStage, detail: str = "") -> None:
        """Set the connection stage (thread-safe)."""
        if QtCore.QThread.currentThread() is self.thread():
            self._apply_stage(stage, detail)
        else:
            self._post_to_qt(lambda: self._apply_stage(stage, detail))

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _apply_stage(self, stage: ConnectionStage, detail: str = "") -> None:
        """Apply stage change on the Qt thread (not thread-safe by itself)."""
        if stage == self._stage and detail == self._detail:
            return  # deduplicate

        self._stage = stage
        self._detail = detail

        # Manage discovery timeout timer
        if stage == ConnectionStage.DISCOVERING_DEVICES:
            self._discovery_timer.start()
        else:
            self._discovery_timer.stop()

        # Build human-readable text
        text = stage.label
        if detail:
            text = f"{text} ({detail})"

        self.stage_changed.emit(stage)
        self.status_text_changed.emit(text)

    @QtCore.Slot()
    def _on_discovery_timeout(self) -> None:
        """If still discovering after 3s, advance to READY."""
        if self._stage == ConnectionStage.DISCOVERING_DEVICES:
            self._apply_stage(ConnectionStage.READY, "no devices found")
