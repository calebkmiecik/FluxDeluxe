from __future__ import annotations

from PySide6.QtCore import Qt, Signal, QObject
from PySide6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QPlainTextEdit,
    QPushButton,
    QCheckBox,
)
from PySide6.QtGui import QFont, QTextCursor


class LogSignals(QObject):
    """Signals for thread-safe log updates."""
    log_received = Signal(str)


class BackendLogDialog(QDialog):
    """Dialog that displays DynamoPy backend logs in real-time.

    Uses the callback system in fluxdeluxe.main to receive log lines from the
    backend drain threads, so it works automatically across backend restarts.
    """

    _instance: "BackendLogDialog | None" = None

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("DynamoPy Backend Logs")
        self.setMinimumSize(800, 500)
        self.resize(900, 600)

        # Allow dialog to stay open while interacting with main window
        self.setWindowFlags(self.windowFlags() | Qt.WindowType.Window)

        self._setup_ui()
        self._signals = LogSignals()
        self._signals.log_received.connect(self._append_log)
        self._subscribed = False

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        # Log display area
        self._log_view = QPlainTextEdit()
        self._log_view.setReadOnly(True)
        self._log_view.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        self._log_view.setFont(QFont("Consolas", 9))
        self._log_view.setStyleSheet(
            "QPlainTextEdit { background-color: #1e1e1e; color: #d4d4d4; }"
        )
        layout.addWidget(self._log_view)

        # Bottom controls
        controls = QHBoxLayout()

        self._auto_scroll_cb = QCheckBox("Auto-scroll")
        self._auto_scroll_cb.setChecked(True)
        controls.addWidget(self._auto_scroll_cb)

        controls.addStretch()

        clear_btn = QPushButton("Clear")
        clear_btn.clicked.connect(self._log_view.clear)
        controls.addWidget(clear_btn)

        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.hide)
        controls.addWidget(close_btn)

        layout.addLayout(controls)

    def _append_log(self, text: str):
        """Append log text to the view (called from signal, thread-safe)."""
        self._log_view.appendPlainText(text.rstrip())
        if self._auto_scroll_cb.isChecked():
            self._log_view.moveCursor(QTextCursor.MoveOperation.End)

    def _on_backend_log_line(self, text: str) -> None:
        """Callback invoked by the drain threads in fluxdeluxe.main (any thread)."""
        self._signals.log_received.emit(text)

    def start_reading(self, _process=None) -> None:
        """Subscribe to backend log output via the drain-thread callback system.

        The *_process* parameter is accepted for backward compatibility but is
        ignored -- pipe reading is now handled by the drain threads in
        ``fluxdeluxe.main``.
        """
        if self._subscribed:
            return
        try:
            from fluxdeluxe.main import register_backend_log_callback, get_backend_log_buffer
            register_backend_log_callback(self._on_backend_log_line)
            self._subscribed = True
            # Replay buffered lines so the dialog shows history
            for line in get_backend_log_buffer():
                self._signals.log_received.emit(line)
        except Exception:
            pass

    def stop_reading(self) -> None:
        """Unsubscribe from backend log output."""
        if not self._subscribed:
            return
        try:
            from fluxdeluxe.main import unregister_backend_log_callback
            unregister_backend_log_callback(self._on_backend_log_line)
        except Exception:
            pass
        self._subscribed = False

    def closeEvent(self, event):
        """Hide instead of close so we can reopen."""
        self.hide()
        event.ignore()

    @classmethod
    def get_instance(cls, parent=None) -> "BackendLogDialog":
        """Get or create the singleton instance."""
        if cls._instance is None:
            cls._instance = cls(parent)
        return cls._instance
