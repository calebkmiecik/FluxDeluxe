from __future__ import annotations

from typing import List, Optional, Tuple

from PySide6 import QtCore, QtGui, QtWidgets

from ... import config
from ..state import ViewState
from .live_testing_panel import LiveTestingPanel
from .temperature_testing_panel import TemperatureTestingPanel
from ..delegates import DeviceListDelegate


class ControlPanel(QtWidgets.QWidget):
    config_changed = QtCore.Signal()
    refresh_devices_requested = QtCore.Signal()
    live_testing_tab_selected = QtCore.Signal()
    # Backend configuration updates (Config tab, right-hand pane)
    backend_config_update = QtCore.Signal(object)  # dict with any config keys to update
    backend_restart_requested = QtCore.Signal()  # request to restart backend

    def __init__(self, state: ViewState, controller: object = None, parent: Optional[QtWidgets.QWidget] = None) -> None:
        super().__init__(parent)
        self.state = state
        self.controller = controller

        def _fixh(w: QtWidgets.QWidget, h: int = 22) -> None:
            w.setFixedHeight(h)

        def _fix_btn(b: QtWidgets.QPushButton, wmin: int = 110, h: int = 26) -> None:
            b.setFixedHeight(h)
            b.setMinimumWidth(wmin)
            b.setSizePolicy(QtWidgets.QSizePolicy.Fixed, QtWidgets.QSizePolicy.Fixed)

        root = QtWidgets.QVBoxLayout(self)
        root.setSpacing(8)
        root.setContentsMargins(6, 6, 6, 6)

        tabs = QtWidgets.QTabWidget()
        self.tabs = tabs

        # ── Config tab ──────────────────────────────────────────────────
        config_tab = QtWidgets.QWidget()
        cfg_layout = QtWidgets.QGridLayout(config_tab)
        cfg_layout.setColumnStretch(0, 2)
        cfg_layout.setColumnStretch(1, 1)

        # Left column: layout mode, device filters, and device list
        cfg_left = QtWidgets.QWidget()
        cfg_left_layout = QtWidgets.QVBoxLayout(cfg_left)
        cfg_left_layout.setContentsMargins(0, 0, 0, 0)
        cfg_left_layout.setSpacing(6)

        layout_row = QtWidgets.QWidget()
        layout_row_layout = QtWidgets.QHBoxLayout(layout_row)
        layout_row_layout.setContentsMargins(0, 0, 0, 0)
        layout_row_layout.setSpacing(6)
        self.rb_layout_single = QtWidgets.QRadioButton("Single Device")
        self.rb_layout_mound = QtWidgets.QRadioButton("Pitching Mound")
        self.rb_layout_single.setChecked(True)
        layout_row_layout.addWidget(self.rb_layout_single)
        layout_row_layout.addWidget(self.rb_layout_mound)
        layout_row_layout.addStretch(1)
        cfg_left_layout.addWidget(layout_row)
        self.state.display_mode = "single"

        filter_row = QtWidgets.QWidget()
        filter_row_layout = QtWidgets.QHBoxLayout(filter_row)
        filter_row_layout.setContentsMargins(0, 0, 0, 0)
        filter_row_layout.setSpacing(6)
        self.chk_filter_06 = QtWidgets.QCheckBox("Show 06 (Lite)")
        self.chk_filter_06.setChecked(True)
        self.chk_filter_07 = QtWidgets.QCheckBox("Show 07 (Launchpad)")
        self.chk_filter_07.setChecked(True)
        self.chk_filter_08 = QtWidgets.QCheckBox("Show 08 (XL)")
        self.chk_filter_08.setChecked(True)
        filter_row_layout.addWidget(self.chk_filter_06)
        filter_row_layout.addWidget(self.chk_filter_07)
        filter_row_layout.addWidget(self.chk_filter_08)
        filter_row_layout.addStretch(1)
        cfg_left_layout.addWidget(filter_row)

        self.device_list = QtWidgets.QListWidget()
        self.device_list.setSelectionMode(QtWidgets.QAbstractItemView.SingleSelection)
        self.device_list.setItemDelegate(DeviceListDelegate())
        cfg_left_layout.addWidget(self.device_list, 1)

        cfg_layout.addWidget(cfg_left, 0, 0, 1, 1)

        # Right column: Backend configuration quick settings
        backend_box = QtWidgets.QGroupBox("Backend Config")
        backend_layout = QtWidgets.QGridLayout(backend_box)
        backend_layout.setVerticalSpacing(6)
        row = 0

        # Data Processing section
        processing_group = QtWidgets.QGroupBox("Data Processing")
        processing_layout = QtWidgets.QGridLayout(processing_group)
        processing_layout.setVerticalSpacing(4)
        pr = 0

        # Capture detail
        processing_layout.addWidget(QtWidgets.QLabel("Capture Detail:"), pr, 0)
        self.capture_detail_combo = QtWidgets.QComboBox()
        self.capture_detail_combo.addItems(["basic", "all", "allSums", "allTemp"])
        self.capture_detail_combo.setCurrentText("allTemp")
        processing_layout.addWidget(self.capture_detail_combo, pr, 1)
        pr += 1

        # Emission rate
        processing_layout.addWidget(QtWidgets.QLabel("Emission Rate (Hz):"), pr, 0)
        self.spin_emission_rate = QtWidgets.QSpinBox()
        self.spin_emission_rate.setRange(1, 240)
        self.spin_emission_rate.setValue(60)
        processing_layout.addWidget(self.spin_emission_rate, pr, 1)
        pr += 1

        # Moving average window
        processing_layout.addWidget(QtWidgets.QLabel("Avg Window:"), pr, 0)
        self.spin_avg_window = QtWidgets.QSpinBox()
        self.spin_avg_window.setRange(1, 101)
        self.spin_avg_window.setValue(11)
        processing_layout.addWidget(self.spin_avg_window, pr, 1)
        pr += 1

        # Moving average type
        processing_layout.addWidget(QtWidgets.QLabel("Avg Type:"), pr, 0)
        self.avg_type_combo = QtWidgets.QComboBox()
        self.avg_type_combo.addItems(["simple", "gaussian", "smartGaussian"])
        self.avg_type_combo.setCurrentText("smartGaussian")
        processing_layout.addWidget(self.avg_type_combo, pr, 1)
        pr += 1

        # Bypass models
        self.chk_bypass_models = QtWidgets.QCheckBox("Bypass ML Models")
        processing_layout.addWidget(self.chk_bypass_models, pr, 0, 1, 2)

        backend_layout.addWidget(processing_group, row, 0, 1, 2)
        row += 1

        # Temperature correction
        temp_group = QtWidgets.QGroupBox("Temperature Correction")
        temp_layout = QtWidgets.QGridLayout(temp_group)
        temp_layout.setVerticalSpacing(4)
        tr = 0
        self.chk_use_temp_corr = QtWidgets.QCheckBox("Enable Temperature Correction")
        temp_layout.addWidget(self.chk_use_temp_corr, tr, 0, 1, 2)
        tr += 1

        # Room temperature
        temp_layout.addWidget(QtWidgets.QLabel("Room Temp (\u00b0F):"), tr, 0)
        self.spin_room_temp = QtWidgets.QDoubleSpinBox()
        self.spin_room_temp.setRange(-100.0, 300.0)
        self.spin_room_temp.setDecimals(1)
        self.spin_room_temp.setSingleStep(0.5)
        self.spin_room_temp.setValue(76.0)
        temp_layout.addWidget(self.spin_room_temp, tr, 1)
        tr += 1

        # Device-specific scalars dropdown
        temp_layout.addWidget(QtWidgets.QLabel("Device Type:"), tr, 0)
        self.device_type_combo = QtWidgets.QComboBox()
        self.device_type_combo.addItems(["06 (Lite)", "07 (Launchpad)", "08 (XL)", "10", "11", "12"])
        temp_layout.addWidget(self.device_type_combo, tr, 1)
        tr += 1

        # Scalars for selected device type
        temp_layout.addWidget(QtWidgets.QLabel("Scalar X:"), tr, 0)
        self.spin_temp_x = QtWidgets.QDoubleSpinBox()
        self.spin_temp_x.setRange(0.0, 1.0)
        self.spin_temp_x.setDecimals(4)
        self.spin_temp_x.setSingleStep(0.0001)
        self.spin_temp_x.setValue(0.002)
        temp_layout.addWidget(self.spin_temp_x, tr, 1)
        tr += 1

        temp_layout.addWidget(QtWidgets.QLabel("Scalar Y:"), tr, 0)
        self.spin_temp_y = QtWidgets.QDoubleSpinBox()
        self.spin_temp_y.setRange(0.0, 1.0)
        self.spin_temp_y.setDecimals(4)
        self.spin_temp_y.setSingleStep(0.0001)
        self.spin_temp_y.setValue(0.002)
        temp_layout.addWidget(self.spin_temp_y, tr, 1)
        tr += 1

        temp_layout.addWidget(QtWidgets.QLabel("Scalar Z:"), tr, 0)
        self.spin_temp_z = QtWidgets.QDoubleSpinBox()
        self.spin_temp_z.setRange(0.0, 1.0)
        self.spin_temp_z.setDecimals(4)
        self.spin_temp_z.setSingleStep(0.0001)
        self.spin_temp_z.setValue(0.002)
        temp_layout.addWidget(self.spin_temp_z, tr, 1)
        tr += 1

        # Buttons row
        button_row = QtWidgets.QWidget()
        button_layout = QtWidgets.QHBoxLayout(button_row)
        button_layout.setContentsMargins(0, 0, 0, 0)
        button_layout.setSpacing(6)

        self.btn_view_full_config = QtWidgets.QPushButton("View Full Settings")
        self.btn_restart_backend = QtWidgets.QPushButton("Restart Backend")

        button_layout.addWidget(self.btn_view_full_config)
        button_layout.addWidget(self.btn_restart_backend)

        temp_layout.addWidget(button_row, tr, 0, 1, 2)

        backend_layout.addWidget(temp_group, row, 0, 1, 2)
        row += 1

        backend_layout.setRowStretch(row, 1)
        cfg_layout.addWidget(backend_box, 0, 1, 1, 1)

        self._config_tab_index = tabs.addTab(config_tab, "Config")

        # ── Live Testing tab ────────────────────────────────────────────
        live_ctrl = getattr(self.controller, "live_test", None) if self.controller else None
        self.live_testing_panel = LiveTestingPanel(self.state, live_ctrl)

        live_scroll = QtWidgets.QScrollArea()
        live_scroll.setWidget(self.live_testing_panel)
        live_scroll.setWidgetResizable(True)
        live_scroll.setFrameShape(QtWidgets.QFrame.NoFrame)

        self._live_tab_index = tabs.addTab(live_scroll, "Live Testing")

        # ── Temperature Testing tab ─────────────────────────────────────
        temp_ctrl = getattr(self.controller, "temp_test", None) if self.controller else None
        self.temperature_testing_panel = TemperatureTestingPanel(temp_ctrl)
        self.temperature_testing_panel.setObjectName("temperature_testing_panel")

        temp_scroll = QtWidgets.QScrollArea()
        temp_scroll.setWidget(self.temperature_testing_panel)
        temp_scroll.setWidgetResizable(True)
        temp_scroll.setFrameShape(QtWidgets.QFrame.NoFrame)

        self._temp_tab_index = tabs.addTab(temp_scroll, "Temperature Testing")

        # Ensure tabs consume available vertical space
        try:
            tabs.setSizePolicy(QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Expanding)
        except Exception:
            pass

        self._all_devices: List[Tuple[str, str, str]] = []
        self._active_device_ids: set = set()

        # Store device-specific temperature scalars
        self._device_temp_scalars = {
            "06": {"x": 0.002, "y": 0.002, "z": 0.002},
            "07": {"x": 0.0025, "y": 0.0025, "z": 0.0025},
            "08": {"x": 0.0009, "y": 0.0009, "z": 0.0009},
            "10": {"x": 0.002, "y": 0.002, "z": 0.002},
            "11": {"x": 0.0025, "y": 0.0025, "z": 0.0025},
            "12": {"x": 0.0009, "y": 0.0009, "z": 0.0009},
        }

        # FluxLite desired defaults (sent to backend on startup)
        self._fluxlite_defaults = {
            "capture_detail": "allTemp",
            "auto_save_csvs": True,
            "normalize_data": False,
            "emission_rate": 60,
            "moving_average_window": 11,
            "moving_average_type": "smartGaussian",
            "bypass_models": False,
            "use_temperature_correction": True,
            "room_temperature_f": 76.0,
            "temperature_correction_06": {"x": 0.002, "y": 0.002, "z": 0.002},
            "temperature_correction_07": {"x": 0.0025, "y": 0.0025, "z": 0.0025},
            "temperature_correction_08": {"x": 0.0009, "y": 0.0009, "z": 0.0009},
            "temperature_correction_10": {"x": 0.002, "y": 0.002, "z": 0.002},
            "temperature_correction_11": {"x": 0.0025, "y": 0.0025, "z": 0.0025},
            "temperature_correction_12": {"x": 0.0009, "y": 0.0009, "z": 0.0009},
        }
        self._config_loaded = False

        root.addWidget(tabs)

        # ── Signal connections ──────────────────────────────────────────
        self.chk_filter_06.stateChanged.connect(self._on_filter_changed)
        self.chk_filter_07.stateChanged.connect(self._on_filter_changed)
        self.chk_filter_08.stateChanged.connect(self._on_filter_changed)
        self.rb_layout_mound.toggled.connect(self._on_layout_changed)
        self.rb_layout_single.toggled.connect(self._on_layout_changed)
        self.device_list.currentItemChanged.connect(self._on_device_selected)
        self.tabs.currentChanged.connect(self._on_tab_changed)

        # Backend Config - Real-time updates
        self.capture_detail_combo.currentTextChanged.connect(self._on_config_changed)
        self.spin_emission_rate.valueChanged.connect(self._on_config_changed)
        self.spin_avg_window.valueChanged.connect(self._on_config_changed)
        self.avg_type_combo.currentTextChanged.connect(self._on_config_changed)
        self.chk_bypass_models.toggled.connect(self._on_config_changed)
        self.chk_use_temp_corr.toggled.connect(self._on_config_changed)
        self.spin_room_temp.valueChanged.connect(self._on_config_changed)
        self.device_type_combo.currentIndexChanged.connect(self._on_device_type_changed)
        self.spin_temp_x.valueChanged.connect(self._on_scalar_changed)
        self.spin_temp_y.valueChanged.connect(self._on_scalar_changed)
        self.spin_temp_z.valueChanged.connect(self._on_scalar_changed)

        # Action buttons
        self.btn_view_full_config.clicked.connect(self._show_full_config_dialog)
        self.btn_restart_backend.clicked.connect(lambda: self.backend_restart_requested.emit())

    def apply_fluxlite_defaults(self) -> None:
        """Send FluxLite defaults to backend on startup."""
        try:
            print("[ControlPanel] Applying FluxLite defaults to backend...")
            self.backend_config_update.emit(self._fluxlite_defaults)
        except Exception as e:
            print(f"[ControlPanel] Error applying defaults: {e}")

    def _on_config_changed(self) -> None:
        """Handle real-time config updates when any control changes."""
        if not self._config_loaded:
            return  # Don't emit changes until initial config is loaded

        try:
            payload = {
                "capture_detail": str(self.capture_detail_combo.currentText()),
                "emission_rate": int(self.spin_emission_rate.value()),
                "moving_average_window": int(self.spin_avg_window.value()),
                "moving_average_type": str(self.avg_type_combo.currentText()),
                "bypass_models": bool(self.chk_bypass_models.isChecked()),
                "use_temperature_correction": bool(self.chk_use_temp_corr.isChecked()),
                "room_temperature_f": float(self.spin_room_temp.value()),
            }
            self.backend_config_update.emit(payload)
        except Exception as e:
            print(f"[ControlPanel] Error updating config: {e}")

    def _on_scalar_changed(self) -> None:
        """Handle real-time scalar updates."""
        if not self._config_loaded:
            return

        try:
            device_type = self._get_current_device_type()
            if device_type:
                # Update stored scalars
                self._device_temp_scalars[device_type] = {
                    "x": float(self.spin_temp_x.value()),
                    "y": float(self.spin_temp_y.value()),
                    "z": float(self.spin_temp_z.value()),
                }

                # Send to backend
                key = f"temperature_correction_{device_type}"
                payload = {key: self._device_temp_scalars[device_type]}
                self.backend_config_update.emit(payload)
        except Exception as e:
            print(f"[ControlPanel] Error updating scalars: {e}")

    def _on_device_type_changed(self, _index: int) -> None:
        """Load scalars for the selected device type."""
        try:
            device_type = self._get_current_device_type()
            if device_type in self._device_temp_scalars:
                scalars = self._device_temp_scalars[device_type]
                # Temporarily block signals to avoid triggering _on_scalar_changed
                self.spin_temp_x.blockSignals(True)
                self.spin_temp_y.blockSignals(True)
                self.spin_temp_z.blockSignals(True)

                self.spin_temp_x.setValue(scalars["x"])
                self.spin_temp_y.setValue(scalars["y"])
                self.spin_temp_z.setValue(scalars["z"])

                self.spin_temp_x.blockSignals(False)
                self.spin_temp_y.blockSignals(False)
                self.spin_temp_z.blockSignals(False)
        except Exception:
            pass

    def _get_current_device_type(self) -> str:
        """Get the device type ID from the combo box selection."""
        text = self.device_type_combo.currentText()
        return text.split()[0]  # Extract "06", "07", "08", etc.

    def _show_full_config_dialog(self) -> None:
        """Show a dialog with the full backend config as editable JSON."""
        # TODO: Implement JSON editor dialog
        print("[ControlPanel] View Full Settings clicked - dialog not yet implemented")

    def set_available_devices(self, devices: List[Tuple[str, str, str]]) -> None:
        self._all_devices = devices or []
        self._populate_device_list()

    def _populate_device_list(self) -> None:
        show06 = self.chk_filter_06.isChecked()
        show07 = self.chk_filter_07.isChecked()
        show08 = self.chk_filter_08.isChecked()
        selected_id = self.state.selected_device_id or ""
        self.device_list.blockSignals(True)
        self.device_list.clear()
        for name, axf_id, dev_type in self._all_devices:
            if dev_type == "06" and not show06:
                continue
            if dev_type == "07" and not show07:
                continue
            if dev_type == "11" and not show07:  # 11 uses same filter as 07 (identical dimensions)
                continue
            if dev_type == "08" and not show08:
                continue
            display = f"{name} ({axf_id})"
            item = QtWidgets.QListWidgetItem(display)
            item.setData(QtCore.Qt.UserRole, (name, axf_id, dev_type))
            # Initialize with correct active state based on stored active device IDs
            is_active = any(axf_id in active_id or active_id in axf_id for active_id in self._active_device_ids)
            item.setData(QtCore.Qt.UserRole + 1, is_active)
            print(f"[ControlPanel] _populate_device_list: {axf_id} -> is_active={is_active}")
            self.device_list.addItem(item)
            if selected_id and axf_id == selected_id:
                self.device_list.setCurrentItem(item)
        self.device_list.blockSignals(False)
        self.device_list.setEnabled(self.rb_layout_single.isChecked())

    def update_active_devices(self, active_device_ids: set) -> None:
        print(f"[ControlPanel] update_active_devices called with: {active_device_ids}")
        self._active_device_ids = active_device_ids
        for i in range(self.device_list.count()):
            item = self.device_list.item(i)
            if item is None:
                continue
            try:
                name, axf_id, dev_type = item.data(QtCore.Qt.UserRole)
                is_active = any(axf_id in active_id or active_id in axf_id for active_id in active_device_ids)
                item.setData(QtCore.Qt.UserRole + 1, is_active)
                print(f"[ControlPanel] Device {axf_id}: is_active={is_active}")
                display = f"{name} ({axf_id})"
                item.setText(display)
                item.setForeground(QtGui.QColor(255, 255, 255))
            except Exception as e:
                print(f"[ControlPanel] Error updating device: {e}")
                continue
        self.device_list.viewport().update()
        print(f"[ControlPanel] Viewport updated, forcing repaint...")
        self.device_list.repaint()

    def _on_filter_changed(self) -> None:
        self._populate_device_list()

    def _on_layout_changed(self, _checked: bool) -> None:
        if self.rb_layout_mound.isChecked():
            self.state.display_mode = "mound"
            self.state.selected_device_id = None
            self.state.selected_device_type = None
        else:
            self.state.display_mode = "single"
        self._populate_device_list()
        self.config_changed.emit()

    def _on_device_selected(self, current: Optional[QtWidgets.QListWidgetItem], _previous: Optional[QtWidgets.QListWidgetItem]) -> None:
        if current is None:
            return
        try:
            name, axf_id, dev_type = current.data(QtCore.Qt.UserRole)
        except Exception:
            return
        self.state.selected_device_id = str(axf_id)
        self.state.selected_device_type = str(dev_type)
        self.state.selected_device_name = str(name)
        self.state.display_mode = "single"
        self.config_changed.emit()

    def load_backend_config(self, config: dict) -> None:
        """Load backend config into UI controls."""
        try:
            # On first load, apply FluxLite defaults to backend
            if not self._config_loaded:
                self.apply_fluxlite_defaults()

            # Block signals while loading to avoid triggering real-time updates
            self.capture_detail_combo.blockSignals(True)
            self.spin_emission_rate.blockSignals(True)
            self.spin_avg_window.blockSignals(True)
            self.avg_type_combo.blockSignals(True)
            self.chk_bypass_models.blockSignals(True)
            self.chk_use_temp_corr.blockSignals(True)
            self.spin_room_temp.blockSignals(True)

            # Data processing settings
            if "capture_detail" in config:
                self.capture_detail_combo.setCurrentText(str(config["capture_detail"]))

            if "emission_rate" in config:
                self.spin_emission_rate.setValue(int(config["emission_rate"]))

            if "moving_average_window" in config:
                self.spin_avg_window.setValue(int(config["moving_average_window"]))

            if "moving_average_type" in config and config["moving_average_type"]:
                self.avg_type_combo.setCurrentText(str(config["moving_average_type"]))

            if "bypass_models" in config:
                self.chk_bypass_models.setChecked(bool(config["bypass_models"]))

            # Temperature correction settings
            if "use_temperature_correction" in config:
                self.chk_use_temp_corr.setChecked(bool(config["use_temperature_correction"]))

            if "room_temperature_f" in config:
                self.spin_room_temp.setValue(float(config["room_temperature_f"]))

            # Load device-specific temperature scalars
            for device_type in ["06", "07", "08", "10", "11", "12"]:
                key = f"temperature_correction_{device_type}"
                if key in config and isinstance(config[key], dict):
                    self._device_temp_scalars[device_type] = config[key]

            # Load scalars for currently selected device type
            self._on_device_type_changed(0)

            # Unblock signals
            self.capture_detail_combo.blockSignals(False)
            self.spin_emission_rate.blockSignals(False)
            self.spin_avg_window.blockSignals(False)
            self.avg_type_combo.blockSignals(False)
            self.chk_bypass_models.blockSignals(False)
            self.chk_use_temp_corr.blockSignals(False)
            self.spin_room_temp.blockSignals(False)

            self._config_loaded = True
            print(f"[ControlPanel] Backend config loaded into UI")
        except Exception as e:
            print(f"[ControlPanel] Error loading backend config: {e}")

    def _on_tab_changed(self, idx: int) -> None:
        try:
            if idx == getattr(self, "_config_tab_index", -1):
                self.refresh_devices_requested.emit()
            if idx == getattr(self, "_live_tab_index", -1):
                self.live_testing_tab_selected.emit()
        except Exception:
            pass
