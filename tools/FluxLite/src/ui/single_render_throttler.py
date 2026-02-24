from __future__ import annotations

from typing import Dict, Optional, Protocol, Tuple


class _Canvas(Protocol):
    def set_single_snapshot(self, snap: Optional[Tuple[float, float, float, int, bool, float, float]]) -> None: ...


class _SensorPlot(Protocol):
    def add_points_batch(self, points: list) -> None: ...

    def set_temperature_f(self, value_f: Optional[float]) -> None: ...


class _MomentsView(Protocol):
    def set_moments(self, moments: Dict[str, Tuple[int, float, float, float]]) -> None: ...


class SingleModeRenderThrottler:
    """
    Buffer single-device live data and flush to Qt widgets at a stable UI rate.

    The backend can emit frames at ~100 Hz.  We buffer the latest snapshot,
    accumulate force-plot points, and store the latest temperature & moments,
    then flush once per GUI-thread timer tick (~60 Hz).
    """

    def __init__(self) -> None:
        self._snap: Optional[Tuple[float, float, float, int, bool, float, float]] = None
        self._force_points: list[Tuple[int, float, float, float]] = []
        self._temp_f: Optional[float] = None
        self._temp_dirty: bool = False
        self._moments: Optional[Dict[str, Tuple[int, float, float, float]]] = None
        self._dirty: bool = False

    def buffer_single_frame(
        self,
        snap: Tuple[float, float, float, int, bool, float, float],
        t_ms: int,
        fx: float,
        fy: float,
        fz: float,
        avg_temp_f: Optional[float],
    ) -> None:
        """Buffer one live frame from the selected single device."""
        self._snap = snap
        self._force_points.append((int(t_ms), float(fx), float(fy), float(fz)))
        self._temp_f = avg_temp_f
        self._temp_dirty = True
        self._dirty = True

    def buffer_moments(self, moments_data: Dict[str, Tuple[int, float, float, float]]) -> None:
        """Buffer the latest moments dict (latest-wins)."""
        self._moments = moments_data
        self._dirty = True

    def on_tick(
        self,
        *,
        canvas_left: Optional[_Canvas],
        canvas_right: Optional[_Canvas],
        sensor_plot_left: Optional[_SensorPlot],
        sensor_plot_right: Optional[_SensorPlot],
        moments_view_left: Optional[_MomentsView],
        moments_view_right: Optional[_MomentsView],
    ) -> None:
        """Flush buffered state to widgets.  Called from a GUI-thread QTimer."""
        if not self._dirty:
            return
        self._dirty = False

        try:
            # Canvas: latest COP snapshot
            snap = self._snap
            if snap is not None:
                self._snap = None
                if canvas_left:
                    canvas_left.set_single_snapshot(snap)
                if canvas_right:
                    canvas_right.set_single_snapshot(snap)

            # Force plot: batch-flush accumulated points
            points = self._force_points
            if points:
                self._force_points = []
                if sensor_plot_left:
                    sensor_plot_left.add_points_batch(points)
                if sensor_plot_right:
                    sensor_plot_right.add_points_batch(points)

            # Temperature
            if self._temp_dirty:
                self._temp_dirty = False
                temp = self._temp_f
                if sensor_plot_left:
                    sensor_plot_left.set_temperature_f(temp)
                if sensor_plot_right:
                    sensor_plot_right.set_temperature_f(temp)

            # Moments
            moments = self._moments
            if moments is not None:
                self._moments = None
                if moments_view_left:
                    moments_view_left.set_moments(moments)
                if moments_view_right:
                    moments_view_right.set_moments(moments)
        except Exception:
            return

    def reset(self) -> None:
        """Clear all buffers (call on mode/device switch)."""
        self._snap = None
        self._force_points.clear()
        self._temp_f = None
        self._temp_dirty = False
        self._moments = None
        self._dirty = False
