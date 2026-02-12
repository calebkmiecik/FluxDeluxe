from __future__ import annotations
from PySide6 import QtCore
import threading

from ...app_services.hardware import HardwareService
from ...app_services.testing import TestingService
from ...app_services.model_service import ModelService
from .live_test_controller import LiveTestController
from .temp_test_controller import TempTestController
from .calibration_controller import CalibrationController

class MainController(QtCore.QObject):
    """
    Main controller for the application.
    Coordinates services and provides a central access point for application logic.
    """
    restart_countdown = QtCore.Signal(int)  # Emits countdown seconds (5, 4, 3, 2, 1, 0)
    _stop_complete = QtCore.Signal()  # Emitted (from any thread) when backend stop finishes

    def __init__(self):
        super().__init__()
        self.hardware = HardwareService()
        self.testing = TestingService(self.hardware)
        self.models = ModelService(self.hardware)

        self.live_test = LiveTestController(self.testing)
        self.temp_test = TempTestController(self.testing, self.hardware)
        self.calibration = CalibrationController()

        self._restart_timer = QtCore.QTimer()
        self._restart_timer.timeout.connect(self._on_restart_countdown_tick)
        self._restart_countdown_remaining = 0
        self._stop_complete.connect(self._on_stop_complete)

    def start(self):
        """Initialize services and start background tasks."""
        # Connect hardware signals to any global handlers if needed
        self.hardware.auto_connect()

    def shutdown(self):
        """Cleanup and shutdown services."""
        self.hardware.disconnect()

    def restart_backend(self):
        """Restart the DynamoPy backend with a 5-second countdown.

        The stop runs in a background thread so the UI stays responsive.
        """
        print("[MainController] Stopping backend (async)...")
        self.restart_countdown.emit(-1)  # signal that stop is in progress
        threading.Thread(
            target=self._stop_backend_thread, daemon=True
        ).start()

    def _stop_backend_thread(self):
        """Run the blocking stop in a worker thread."""
        try:
            from fluxdeluxe.main import stop_dynamo_backend
            stop_dynamo_backend()
            print("[MainController] Backend stopped, starting countdown...")
        except Exception as e:
            print(f"[MainController] Error stopping backend: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self._stop_complete.emit()

    def _on_stop_complete(self):
        """Called on the UI thread after the backend has stopped."""
        self._restart_countdown_remaining = 5
        self.restart_countdown.emit(5)
        self._restart_timer.start(1000)

    def _on_restart_countdown_tick(self):
        """Handle countdown timer ticks."""
        self._restart_countdown_remaining -= 1

        if self._restart_countdown_remaining <= 0:
            self._restart_timer.stop()
            self.restart_countdown.emit(0)
            # Start the backend
            self._start_backend()
        else:
            self.restart_countdown.emit(self._restart_countdown_remaining)

    def _start_backend(self):
        """Start the DynamoPy backend."""
        try:
            from fluxdeluxe.main import start_dynamo_backend
            print("[MainController] Starting backend...")
            start_dynamo_backend()
            print("[MainController] Backend started - auto_connect will find it automatically")
        except Exception as e:
            print(f"[MainController] Error starting backend: {e}")
            import traceback
            traceback.print_exc()
