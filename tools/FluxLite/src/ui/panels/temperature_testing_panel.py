from __future__ import annotations

import datetime
import json
import os
from typing import Optional

from PySide6 import QtCore, QtWidgets, QtGui

from ..widgets.temp_testing_metrics_widget import TempTestingMetricsWidget


class ProcessedRunItemWidget(QtWidgets.QWidget):
    delete_requested = QtCore.Signal(str)

    def __init__(self, text: str, file_path: str, item: QtWidgets.QListWidgetItem, list_widget: QtWidgets.QListWidget, parent=None):
        super().__init__(parent)
        self.file_path = file_path
        self.item = item
        self.list_widget = list_widget

        layout = QtWidgets.QHBoxLayout(self)
        layout.setContentsMargins(4, 2, 4, 2)
        layout.setSpacing(8)
        
        self.label = QtWidgets.QLabel(text)
        self.label.setStyleSheet("background: transparent;")
        layout.addWidget(self.label, 1)
        
        self.btn_delete = QtWidgets.QPushButton("×")
        self.btn_delete.setFixedSize(20, 20)
        self.btn_delete.setCursor(QtCore.Qt.PointingHandCursor)
        self.btn_delete.setStyleSheet("""
            QPushButton {
                border: none;
                color: #888;
                font-weight: bold;
                font-size: 16px;
                background: transparent;
                margin: 0px;
                padding: 0px;
            }
            QPushButton:hover {
                color: #ff4444;
                background: rgba(255, 0, 0, 0.1);
                border-radius: 10px;
            }
        """)
        self.btn_delete.setToolTip("Delete this processed run")
        self.btn_delete.clicked.connect(self._on_delete)
        layout.addWidget(self.btn_delete, 0)

    def _on_delete(self):
        self.delete_requested.emit(self.file_path)

    def mousePressEvent(self, event):
        self.list_widget.setCurrentItem(self.item)
        super().mousePressEvent(event)


class TestFilesDialog(QtWidgets.QDialog):
    """Inspector dialog showing file status and editable meta for a temperature test."""

    def __init__(self, raw_csv_path: str, parent=None, testing_service=None):
        super().__init__(parent)
        self._testing_service = testing_service
        self._raw_csv_path = raw_csv_path
        self._device_dir = os.path.dirname(raw_csv_path)
        self._filename = os.path.basename(raw_csv_path)
        self._capture_name = os.path.splitext(self._filename)[0]

        # Derive related file paths.
        if self._filename.startswith("temp-raw-"):
            suffix = self._filename[len("temp-raw-"):]
            base = suffix[:-4] if suffix.lower().endswith(".csv") else suffix
        else:
            base = os.path.splitext(self._filename)[0]
        self._meta_path = os.path.join(self._device_dir, f"{self._capture_name}.meta.json")
        self._trimmed_path = os.path.join(self._device_dir, f"temp-trimmed-{base}.csv")
        self._raw_path = raw_csv_path
        self._processed_path = ""  # resolved from meta in _load()

        self.setWindowTitle(f"Files — {self._capture_name}")
        self.setMinimumWidth(500)
        self._build_ui()
        self._load()

    def _build_ui(self) -> None:
        layout = QtWidgets.QVBoxLayout(self)
        layout.setSpacing(10)

        # --- File status section ---
        files_box = QtWidgets.QGroupBox("Files on Disk")
        files_layout = QtWidgets.QGridLayout(files_box)
        files_layout.setSpacing(4)

        self._lbl_raw = QtWidgets.QLabel()
        self._btn_plot_raw = QtWidgets.QPushButton("Plot")
        self._btn_plot_raw.setFixedWidth(60)
        self._btn_plot_raw.clicked.connect(lambda: self._plot_csv(self._raw_path, "Raw"))
        self._btn_trim_raw = QtWidgets.QPushButton("Trim")
        self._btn_trim_raw.setFixedWidth(60)
        self._btn_trim_raw.setToolTip("Interactively select a region to keep, discarding the rest")
        self._btn_trim_raw.clicked.connect(self._trim_raw_csv)
        raw_btn_layout = QtWidgets.QHBoxLayout()
        raw_btn_layout.setSpacing(4)
        raw_btn_layout.setContentsMargins(0, 0, 0, 0)
        raw_btn_layout.addWidget(self._btn_plot_raw)
        raw_btn_layout.addWidget(self._btn_trim_raw)
        files_layout.addWidget(QtWidgets.QLabel("Raw CSV:"), 0, 0)
        files_layout.addWidget(self._lbl_raw, 0, 1)
        files_layout.addLayout(raw_btn_layout, 0, 2)

        self._lbl_trimmed = QtWidgets.QLabel()
        self._btn_plot_trimmed = QtWidgets.QPushButton("Plot")
        self._btn_plot_trimmed.setFixedWidth(60)
        self._btn_plot_trimmed.clicked.connect(lambda: self._plot_csv(self._trimmed_path, "Trimmed"))
        self._btn_trim_trimmed = QtWidgets.QPushButton("Trim")
        self._btn_trim_trimmed.setFixedWidth(60)
        self._btn_trim_trimmed.setToolTip("Trim the trimmed CSV and reprocess baseline")
        self._btn_trim_trimmed.clicked.connect(lambda: self._trim_csv(self._trimmed_path, "trimmed"))
        trimmed_btn_layout = QtWidgets.QHBoxLayout()
        trimmed_btn_layout.setSpacing(4)
        trimmed_btn_layout.setContentsMargins(0, 0, 0, 0)
        trimmed_btn_layout.addWidget(self._btn_plot_trimmed)
        trimmed_btn_layout.addWidget(self._btn_trim_trimmed)
        files_layout.addWidget(QtWidgets.QLabel("Trimmed CSV:"), 1, 0)
        files_layout.addWidget(self._lbl_trimmed, 1, 1)
        files_layout.addLayout(trimmed_btn_layout, 1, 2)

        self._lbl_processed = QtWidgets.QLabel()
        self._btn_plot_processed = QtWidgets.QPushButton("Plot")
        self._btn_plot_processed.setFixedWidth(60)
        self._btn_plot_processed.clicked.connect(lambda: self._plot_csv(self._processed_path, "Processed"))
        files_layout.addWidget(QtWidgets.QLabel("Processed CSV:"), 2, 0)
        files_layout.addWidget(self._lbl_processed, 2, 1)
        files_layout.addWidget(self._btn_plot_processed, 2, 2)

        self._lbl_meta = QtWidgets.QLabel()
        files_layout.addWidget(QtWidgets.QLabel("Meta JSON:"), 3, 0)
        files_layout.addWidget(self._lbl_meta, 3, 1)

        # --- Temperature correction revert toggle ---
        self._chk_revert_temp = QtWidgets.QCheckBox("Revert baked temp correction")
        self._chk_revert_temp.setToolTip(
            "Undo Dynamo stage-1 temperature correction that was baked into the raw CSV during capture.\n"
            "Modifies the trimmed CSV, deletes processed files, and reprocesses baseline."
        )
        self._chk_revert_temp.clicked.connect(self._on_revert_temp_toggled)
        files_layout.addWidget(self._chk_revert_temp, 4, 0, 1, 3)

        layout.addWidget(files_box)

        # --- Editable meta section ---
        meta_box = QtWidgets.QGroupBox("Meta (editable)")
        meta_layout = QtWidgets.QGridLayout(meta_box)
        meta_layout.setSpacing(4)

        self._meta_fields: dict[str, QtWidgets.QLineEdit] = {}
        field_defs = [
            ("capture_name", "Capture Name"),
            ("device_id", "Device ID"),
            ("date", "Date"),
            ("tester_name", "Tester Name"),
            ("short_label", "Short Label"),
            ("model_id", "Model ID"),
            ("avg_temp", "Avg Temp (F)"),
            ("body_weight_n", "Body Weight (N)"),
            ("session_type", "Session Type"),
            ("started_at_ms", "Started At (ms)"),
        ]
        for row, (key, label) in enumerate(field_defs):
            meta_layout.addWidget(QtWidgets.QLabel(f"{label}:"), row, 0)
            le = QtWidgets.QLineEdit()
            if key == "capture_name":
                le.setReadOnly(True)
                le.setStyleSheet("color: #888;")
            self._meta_fields[key] = le
            meta_layout.addWidget(le, row, 1)

        layout.addWidget(meta_box)

        # --- Buttons ---
        btn_row = QtWidgets.QHBoxLayout()
        self._btn_infer = QtWidgets.QPushButton("Infer Tester")
        self._btn_infer.setToolTip("Estimate body weight from Fz data and match against known testers")
        self._btn_infer.clicked.connect(self._infer_tester)
        self._btn_save = QtWidgets.QPushButton("Save Meta")
        self._btn_save.clicked.connect(self._save_meta)
        btn_close = QtWidgets.QPushButton("Close")
        btn_close.clicked.connect(self.accept)
        btn_row.addStretch()
        btn_row.addWidget(self._btn_infer)
        btn_row.addWidget(self._btn_save)
        btn_row.addWidget(btn_close)
        layout.addLayout(btn_row)

    def _load(self) -> None:
        """Populate file status labels and meta fields."""
        # File status.
        self._update_file_label(self._lbl_raw, self._btn_plot_raw, self._raw_path)
        self._btn_trim_raw.setEnabled(os.path.isfile(self._raw_path))
        self._update_file_label(self._lbl_trimmed, self._btn_plot_trimmed, self._trimmed_path)
        self._btn_trim_trimmed.setEnabled(os.path.isfile(self._trimmed_path))

        # Resolve processed baseline path from meta.
        self._processed_path = ""
        if os.path.isfile(self._meta_path):
            try:
                with open(self._meta_path, "r", encoding="utf-8") as fh:
                    _m = json.load(fh) or {}
                pb = _m.get("processed_baseline") or {}
                pf = pb.get("processed_off", "")
                if pf:
                    self._processed_path = os.path.join(self._device_dir, pf)
            except Exception:
                pass
        self._update_file_label(self._lbl_processed, self._btn_plot_processed, self._processed_path)

        if os.path.isfile(self._meta_path):
            size_kb = os.path.getsize(self._meta_path) / 1024
            self._lbl_meta.setText(f"Found ({size_kb:.1f} KB)")
            self._lbl_meta.setStyleSheet("color: green;")
        else:
            self._lbl_meta.setText("Missing")
            self._lbl_meta.setStyleSheet("color: red;")

        # Revert-temp checkbox state from meta.
        self._chk_revert_temp.blockSignals(True)
        reverted = False
        if os.path.isfile(self._meta_path):
            try:
                with open(self._meta_path, "r", encoding="utf-8") as fh:
                    _rm = json.load(fh) or {}
                reverted = bool(_rm.get("temp_correction_reverted", False))
            except Exception:
                pass
        self._chk_revert_temp.setChecked(reverted)
        self._chk_revert_temp.setEnabled(os.path.isfile(self._trimmed_path))
        self._chk_revert_temp.blockSignals(False)

        # Meta fields.
        meta = {}
        if os.path.isfile(self._meta_path):
            try:
                with open(self._meta_path, "r", encoding="utf-8") as fh:
                    meta = json.load(fh) or {}
            except Exception:
                meta = {}

        for key, le in self._meta_fields.items():
            val = meta.get(key)
            le.setText(str(val) if val is not None else "")

        # Default capture_name if blank.
        if not self._meta_fields["capture_name"].text():
            self._meta_fields["capture_name"].setText(self._capture_name)

    @staticmethod
    def _update_file_label(label: QtWidgets.QLabel, btn: QtWidgets.QPushButton, path: str) -> None:
        if os.path.isfile(path):
            size_mb = os.path.getsize(path) / (1024 * 1024)
            label.setText(f"Found ({size_mb:.2f} MB)")
            label.setStyleSheet("color: green;")
            btn.setEnabled(True)
        else:
            label.setText("Missing")
            label.setStyleSheet("color: red;")
            btn.setEnabled(False)

    def _save_meta(self) -> None:
        """Write meta fields back to the .meta.json file."""
        meta = {}
        # Preserve existing fields not shown in the form.
        if os.path.isfile(self._meta_path):
            try:
                with open(self._meta_path, "r", encoding="utf-8") as fh:
                    meta = json.load(fh) or {}
            except Exception:
                meta = {}

        # Numeric fields.
        numeric_keys = {"avg_temp", "body_weight_n", "started_at_ms"}
        for key, le in self._meta_fields.items():
            text = le.text().strip()
            if not text:
                continue
            if key in numeric_keys:
                try:
                    meta[key] = float(text) if "." in text else int(text)
                except ValueError:
                    meta[key] = text
            else:
                meta[key] = text

        # Clear synced_at_ms so next sync re-uploads with updated meta.
        meta.pop("synced_at_ms", None)

        try:
            os.makedirs(os.path.dirname(self._meta_path), exist_ok=True)
            with open(self._meta_path, "w", encoding="utf-8") as fh:
                json.dump(meta, fh, indent=2, sort_keys=True)
            QtWidgets.QMessageBox.information(self, "Saved", "Meta file saved.")
            self._load()  # Refresh status labels.
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "Error", f"Failed to save: {exc}")

    def _ensure_processed(self) -> bool:
        """Ensure the processed-off CSV exists, generating it if needed.

        Returns True if the processed file is available after the call.
        Updates ``self._processed_path`` as a side-effect.
        """
        if self._processed_path and os.path.isfile(self._processed_path):
            return True
        if not self._testing_service:
            return False
        try:
            svc = self._testing_service._temp_processing
            device_id = os.path.basename(self._device_dir)
            processed_path = svc.ensure_temp_off_processed(
                folder=self._device_dir,
                device_id=device_id,
                csv_path=self._raw_csv_path,
            )
            if processed_path and os.path.isfile(processed_path):
                self._processed_path = processed_path
                return True
        except Exception as exc:
            QtWidgets.QMessageBox.warning(
                self, "Processing Error",
                f"Failed to generate processed CSV:\n{exc}",
            )
        return False

    def _on_revert_temp_toggled(self) -> None:
        """Revert or re-apply baked temperature correction on the trimmed CSV."""
        import glob as _glob
        from ...app_services.temperature_processing_service import revert_baked_temp_correction

        want_reverted = self._chk_revert_temp.isChecked()
        action = "Revert" if want_reverted else "Undo revert of"
        reply = QtWidgets.QMessageBox.question(
            self,
            "Temp Correction",
            f"{action} baked temperature correction?\n\n"
            "This will modify the trimmed CSV, delete processed files, and reprocess baseline.",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
        )
        if reply != QtWidgets.QMessageBox.Yes:
            self._chk_revert_temp.blockSignals(True)
            self._chk_revert_temp.setChecked(not want_reverted)
            self._chk_revert_temp.blockSignals(False)
            return

        device_id = os.path.basename(self._device_dir)
        try:
            revert_baked_temp_correction(
                self._trimmed_path,
                device_id,
                room_temp_f=76.0,
                undo=not want_reverted,
            )
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "Error", f"Failed to modify trimmed CSV:\n{exc}")
            self._chk_revert_temp.blockSignals(True)
            self._chk_revert_temp.setChecked(not want_reverted)
            self._chk_revert_temp.blockSignals(False)
            return

        # Delete all processed / scalar variant files so baseline gets regenerated.
        suffix = self._capture_name.replace("temp-raw-", "", 1)
        for pattern in (f"temp-processed-{suffix}.csv", f"temp-scalar-*-{suffix}.csv"):
            for fp in _glob.glob(os.path.join(self._device_dir, pattern)):
                try:
                    os.remove(fp)
                except Exception:
                    pass

        # Clear cached processed path so _ensure_processed will regenerate.
        self._processed_path = ""

        # Update meta flag.
        meta = {}
        if os.path.isfile(self._meta_path):
            try:
                with open(self._meta_path, "r", encoding="utf-8") as fh:
                    meta = json.load(fh) or {}
            except Exception:
                meta = {}
        meta["temp_correction_reverted"] = want_reverted
        meta.pop("synced_at_ms", None)
        # Clear processed_baseline so it gets rebuilt.
        meta.pop("processed_baseline", None)
        try:
            with open(self._meta_path, "w", encoding="utf-8") as fh:
                json.dump(meta, fh, indent=2, sort_keys=True)
        except Exception:
            pass

        # Regenerate baseline.
        self._ensure_processed()

        self._load()
        QtWidgets.QMessageBox.information(
            self, "Done",
            f"Trimmed CSV {'reverted' if want_reverted else 'restored'} and baseline reprocessed.",
        )

    def _infer_tester(self) -> None:
        """Estimate body weight from calibrated Fz in the processed CSV."""
        import datetime as _dt
        from ..controllers.temp_test_workers import _estimate_body_weight_n

        # Ensure we have a processed file with calibrated Fz
        if not self._ensure_processed():
            QtWidgets.QMessageBox.warning(
                self, "Infer Tester",
                "Could not generate processed CSV — cannot estimate body weight.",
            )
            return
        self._load()  # refresh labels since processed file may have just been created

        est = _estimate_body_weight_n(self._processed_path)
        if est is None:
            QtWidgets.QMessageBox.warning(self, "Infer Tester", "Could not estimate body weight from processed CSV data.")
            return

        # Build known tester lookup from all meta files in temp_testing root
        root = os.path.dirname(self._device_dir)  # temp_testing/
        known: list[tuple[str, float, str]] = []  # (date, weight, name)
        import glob
        for mp in glob.glob(os.path.join(root, "**", "*.meta.json"), recursive=True):
            try:
                with open(mp, "r", encoding="utf-8") as fh:
                    m = json.load(fh) or {}
                bw = m.get("body_weight_n")
                tn = m.get("tester_name")
                dt = m.get("date")
                if bw and tn and dt:
                    known.append((str(dt), float(bw), str(tn)))
            except Exception:
                continue

        if not known:
            QtWidgets.QMessageBox.warning(self, "Infer Tester", f"Estimated BW: {est:.0f} N\n\nNo known testers found in other meta files to match against.")
            return

        def _parse_date(d: str):
            for fmt in ("%Y-%m-%d", "%m-%d-%Y"):
                try:
                    return _dt.datetime.strptime(d, fmt).date()
                except ValueError:
                    continue
            return None

        file_date = _parse_date(self._meta_fields["date"].text().strip())

        # Find matches within 100N, prefer closest date
        matches: list[tuple[int, float, str]] = []  # (date_dist, weight, name)
        for kd, kw, kn in known:
            if abs(kw - est) > 100.0:
                continue
            kdate = _parse_date(kd)
            dist = abs((file_date - kdate).days) if file_date and kdate else 9999
            matches.append((dist, kw, kn))

        if not matches:
            QtWidgets.QMessageBox.information(self, "Infer Tester", f"Estimated BW: {est:.0f} N\n\nNo matching tester found within 100 N.")
            return

        # Sort by date distance, then show best match
        matches.sort(key=lambda x: x[0])
        best_dist, best_weight, best_name = matches[0]

        # Deduplicate match names for display
        seen = set()
        unique_matches = []
        for dist, w, n in matches:
            if n not in seen:
                seen.add(n)
                unique_matches.append((dist, w, n))

        if len(unique_matches) == 1:
            detail = f"Match: {best_name} ({best_weight:.0f} N, {best_dist}d away)"
        else:
            lines = [f"  • {n} ({w:.0f} N, {d}d away)" for d, w, n in unique_matches[:5]]
            detail = "Candidates:\n" + "\n".join(lines) + f"\n\nBest: {best_name}"

        reply = QtWidgets.QMessageBox.question(
            self, "Infer Tester",
            f"Estimated BW from Fz: {est:.0f} N\n\n{detail}\n\nApply {best_name} / {best_weight:.0f} N?",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
        )
        if reply == QtWidgets.QMessageBox.Yes:
            self._meta_fields["tester_name"].setText(best_name)
            self._meta_fields["body_weight_n"].setText(str(best_weight))

    def _trim_raw_csv(self) -> None:
        """Trim the raw CSV interactively."""
        self._trim_csv(self._raw_path, "raw")

    def _trim_csv(self, csv_path: str, which: str) -> None:
        """Open an interactive plot to select a time range, then trim *csv_path* in-place.

        *which* is ``"raw"`` or ``"trimmed"`` and controls post-trim cleanup:
        - **raw**: overwrites raw CSV, deletes trimmed + processed CSVs.
        - **trimmed**: overwrites trimmed CSV in-place, deletes processed CSV
          so the baseline gets reprocessed on next sync.
        """
        if not os.path.isfile(csv_path):
            return
        try:
            from ..widgets.temp_stage_plotter import _load_csv_data
            from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
            from matplotlib.backends.backend_qtagg import NavigationToolbar2QT as NavToolbar
            from matplotlib.figure import Figure
            from matplotlib.widgets import SpanSelector

            times, fz = _load_csv_data(csv_path)
            if not times:
                QtWidgets.QMessageBox.warning(self, "Trim", "No data in CSV.")
                return

            t0 = times[0] if times and times[0] == times[0] else 0.0
            times_rel = [(t - t0) if (t == t) else t for t in times]

            # Build a proper QDialog with embedded matplotlib canvas
            dlg = QtWidgets.QDialog(self)
            dlg.setWindowTitle(f"Trim: {os.path.basename(csv_path)}")
            dlg.resize(1200, 500)
            dlg_layout = QtWidgets.QVBoxLayout(dlg)
            dlg_layout.setContentsMargins(4, 4, 4, 4)

            fig = Figure(figsize=(14, 5))
            canvas = FigureCanvas(fig)
            toolbar = NavToolbar(canvas, dlg)
            dlg_layout.addWidget(toolbar)
            dlg_layout.addWidget(canvas)

            # Confirm button at bottom
            btn_row = QtWidgets.QHBoxLayout()
            lbl_info = QtWidgets.QLabel("Drag on the plot to select the region to KEEP.")
            btn_confirm = QtWidgets.QPushButton("Confirm Selection")
            btn_confirm.setEnabled(False)
            btn_cancel = QtWidgets.QPushButton("Cancel")
            btn_row.addWidget(lbl_info, 1)
            btn_row.addWidget(btn_confirm)
            btn_row.addWidget(btn_cancel)
            dlg_layout.addLayout(btn_row)

            btn_cancel.clicked.connect(dlg.reject)
            btn_confirm.clicked.connect(dlg.accept)

            ax = fig.add_subplot(111)
            ax.plot(times_rel, fz, "b-", linewidth=0.6, alpha=0.7)
            ax.set_title("Drag to select the region to KEEP")
            ax.set_xlabel("Time (ms)")
            ax.set_ylabel("Force Z (N)")
            ax.grid(True, alpha=0.3)

            selection = {}

            def on_select(xmin, xmax):
                selection["xmin"] = xmin
                selection["xmax"] = xmax
                btn_confirm.setEnabled(True)
                lbl_info.setText(f"Selected: {xmin:.0f} \u2013 {xmax:.0f} ms")

            span = SpanSelector(
                ax, on_select, "horizontal",
                useblit=True,
                props=dict(alpha=0.3, facecolor="green"),
                interactive=True,
                drag_from_anywhere=True,
            )
            # prevent GC
            canvas._span_selector = span

            fig.tight_layout()
            canvas.draw()

            if dlg.exec() != QtWidgets.QDialog.Accepted:
                return
            if "xmin" not in selection:
                return

            xmin_abs = selection["xmin"] + t0
            xmax_abs = selection["xmax"] + t0

            # Count rows that will be kept
            import csv as _csv
            with open(csv_path, "r", newline="", encoding="utf-8") as fh:
                reader = _csv.DictReader(fh)
                header_lower = {h.strip().lower(): h for h in (reader.fieldnames or [])}
                time_col = None
                for k in ("time", "time_ms", "elapsed_time"):
                    if k in header_lower:
                        time_col = header_lower[k]
                        break
                total = 0
                kept = 0
                for row in reader:
                    total += 1
                    try:
                        t = float(row.get(time_col) or 0)
                    except (TypeError, ValueError):
                        continue
                    if xmin_abs <= t <= xmax_abs:
                        kept += 1

            if which == "raw":
                detail = "This will overwrite the raw CSV and delete the trimmed/processed CSVs\nso they get regenerated on next sync."
            else:
                detail = "This will overwrite the trimmed CSV and delete the processed CSV\nso the baseline gets reprocessed on next sync."

            reply = QtWidgets.QMessageBox.question(
                self, f"Trim {which.title()} CSV",
                f"Keep {kept:,} of {total:,} rows ({kept*100//max(total,1)}%)?\n\n"
                f"Time range: {selection['xmin']:.0f} \u2013 {selection['xmax']:.0f} ms\n\n"
                f"{detail}",
                QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            )
            if reply != QtWidgets.QMessageBox.Yes:
                return

            # Read all rows, filter, write back
            with open(csv_path, "r", newline="", encoding="utf-8") as fh:
                reader = _csv.DictReader(fh)
                fieldnames = reader.fieldnames
                rows_to_keep = []
                for row in reader:
                    try:
                        t = float(row.get(time_col) or 0)
                    except (TypeError, ValueError):
                        continue
                    if xmin_abs <= t <= xmax_abs:
                        rows_to_keep.append(row)

            with open(csv_path, "w", newline="", encoding="utf-8") as fh:
                writer = _csv.DictWriter(fh, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows_to_keep)

            # Post-trim cleanup depends on which file was trimmed
            if which == "raw":
                # Delete trimmed and processed so they get regenerated
                for path in (self._trimmed_path, self._processed_path):
                    if path and os.path.isfile(path):
                        try:
                            os.remove(path)
                        except Exception:
                            pass
            else:
                # Trimmed was edited — delete processed so baseline gets reprocessed
                if self._processed_path and os.path.isfile(self._processed_path):
                    try:
                        os.remove(self._processed_path)
                    except Exception:
                        pass

            # Clear synced_at_ms so it re-uploads, and update avg_temp
            if os.path.isfile(self._meta_path):
                try:
                    with open(self._meta_path, "r", encoding="utf-8") as fh:
                        meta = json.load(fh) or {}
                    meta.pop("synced_at_ms", None)
                    # If we trimmed raw or trimmed, also clear processed_baseline
                    # references so the pipeline regenerates them
                    if which == "raw":
                        baseline = meta.get("processed_baseline")
                        if isinstance(baseline, dict):
                            baseline.pop("trimmed_csv", None)
                            baseline.pop("processed_off", None)
                            baseline.pop("updated_at_ms", None)
                    elif which == "trimmed":
                        baseline = meta.get("processed_baseline")
                        if isinstance(baseline, dict):
                            baseline.pop("processed_off", None)
                            baseline.pop("updated_at_ms", None)
                    # Update avg_temp from the source of truth (trimmed if exists, else raw)
                    from ..controllers.temp_test_workers import _estimate_avg_temp
                    temp_source = self._trimmed_path if os.path.isfile(self._trimmed_path) else self._raw_path
                    new_temp = _estimate_avg_temp(temp_source)
                    if new_temp is not None:
                        meta["avg_temp"] = new_temp
                    with open(self._meta_path, "w", encoding="utf-8") as fh:
                        json.dump(meta, fh, indent=2, sort_keys=True)
                except Exception:
                    pass

            if which == "raw":
                msg = f"Kept {kept:,} rows. Trimmed/processed CSVs deleted for regeneration."
            else:
                # Trimmed was edited — immediately reprocess baseline
                if self._ensure_processed():
                    msg = f"Kept {kept:,} rows. Baseline reprocessed."
                else:
                    msg = f"Kept {kept:,} rows. Processed CSV deleted \u2014 baseline will reprocess on next sync."
            QtWidgets.QMessageBox.information(self, "Trimmed", msg)
            self._load()

        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "Trim Error", str(exc))

    def _plot_csv(self, csv_path: str, label: str) -> None:
        if not os.path.isfile(csv_path):
            return
        try:
            from ..widgets.temp_stage_plotter import _load_csv_data
            from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
            from matplotlib.backends.backend_qtagg import NavigationToolbar2QT as NavToolbar
            from matplotlib.figure import Figure

            times, fz = _load_csv_data(csv_path)
            if not times:
                QtWidgets.QMessageBox.warning(self, "Plot", f"No Z-axis data in {os.path.basename(csv_path)}")
                return

            t0 = times[0] if times and times[0] == times[0] else 0.0
            times = [(t - t0) if (t == t) else t for t in times]

            dlg = QtWidgets.QDialog(self)
            dlg.setWindowTitle(f"{label}: {os.path.basename(csv_path)}")
            dlg.resize(1100, 500)
            dlg_layout = QtWidgets.QVBoxLayout(dlg)
            dlg_layout.setContentsMargins(4, 4, 4, 4)

            fig = Figure(figsize=(12, 5))
            canvas = FigureCanvas(fig)
            toolbar = NavToolbar(canvas, dlg)
            dlg_layout.addWidget(toolbar)
            dlg_layout.addWidget(canvas)

            ax = fig.add_subplot(111)
            ax.plot(times, fz, "b-", linewidth=0.8, alpha=0.8)
            ax.set_title(f"{label} \u2014 {os.path.basename(csv_path)}")
            ax.set_xlabel("Time (ms)")
            ax.set_ylabel("Force Z (N)")
            ax.grid(True, alpha=0.3)
            ax.axhline(0, color="k", linewidth=0.5)
            fig.tight_layout()
            canvas.draw()

            dlg.show()
            # Keep a reference so the dialog isn't garbage-collected
            if not hasattr(self, "_plot_dialogs"):
                self._plot_dialogs = []
            self._plot_dialogs.append(dlg)
            dlg.finished.connect(lambda: self._plot_dialogs.remove(dlg) if dlg in self._plot_dialogs else None)
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "Plot", f"Failed to plot: {exc}")


class TemperatureTestingPanel(QtWidgets.QWidget):
    run_requested = QtCore.Signal(dict)
    device_selected = QtCore.Signal(str)
    refresh_requested = QtCore.Signal()
    test_changed = QtCore.Signal(str)
    processed_selected = QtCore.Signal(object)  # dict with slopes/paths
    stage_changed = QtCore.Signal(str)
    plot_stages_requested = QtCore.Signal()  # Request matplotlib stage visualization
    grading_mode_changed = QtCore.Signal(str)  # "Absolute" | "Bias Controlled"
    post_correction_changed = QtCore.Signal(bool, float)

    def __init__(self, controller: object = None, parent: Optional[QtWidgets.QWidget] = None) -> None:
        super().__init__(parent)
        self.controller = controller

        root = QtWidgets.QHBoxLayout(self)
        root.setContentsMargins(6, 6, 6, 6)
        root.setSpacing(8)

        # Hidden labels kept for compatibility with existing code
        self.lbl_device_id = QtWidgets.QLabel("—")
        self.lbl_model = QtWidgets.QLabel("—")
        self.lbl_bw = QtWidgets.QLabel("—")

        # Stage selector (moved to Display pane; placeholder init only)
        self.stage_combo = QtWidgets.QComboBox()
        self.stage_combo.addItems(["All"])

        # ── Left column ─────────────────────────────────────────────────
        left_col = QtWidgets.QVBoxLayout()
        left_col.setSpacing(4)
        left_col.setContentsMargins(0, 0, 0, 0)

        # Device row
        device_row = QtWidgets.QHBoxLayout()
        device_row.setSpacing(4)
        self.device_combo = QtWidgets.QComboBox()
        self.btn_refresh = QtWidgets.QPushButton("Refresh")
        self.btn_refresh.setFixedWidth(60)
        device_row.addWidget(QtWidgets.QLabel("Device:"))
        device_row.addWidget(self.device_combo, 1)
        device_row.addWidget(self.btn_refresh)
        left_col.addLayout(device_row)

        # Test list
        lbl_tests = QtWidgets.QLabel("Tests in Device:")
        lbl_tests.setStyleSheet("font-weight: bold; margin-top: 2px;")
        left_col.addWidget(lbl_tests)
        self.test_list = QtWidgets.QListWidget()
        self.test_list.setSelectionMode(QtWidgets.QAbstractItemView.ExtendedSelection)
        self.test_list.setFont(QtGui.QFont("Consolas", 9))
        self.test_list.installEventFilter(self)
        self.test_list.viewport().installEventFilter(self)
        left_col.addWidget(self.test_list, 1)

        # Coefficients — compact single row
        coef_row = QtWidgets.QHBoxLayout()
        coef_row.setSpacing(3)
        self.spin_x = QtWidgets.QDoubleSpinBox()
        self.spin_y = QtWidgets.QDoubleSpinBox()
        self.spin_z = QtWidgets.QDoubleSpinBox()
        for sp in (self.spin_x, self.spin_y, self.spin_z):
            sp.setRange(-1000.0, 1000.0)
            sp.setDecimals(6)
            sp.setSingleStep(0.0001)
            sp.setValue(0.002)
        self.lbl_slope_x = QtWidgets.QLabel("X:")
        self.lbl_slope_y = QtWidgets.QLabel("Y:")
        self.lbl_slope_z = QtWidgets.QLabel("Z:")
        coef_row.addWidget(self.lbl_slope_x)
        coef_row.addWidget(self.spin_x, 1)
        coef_row.addWidget(self.lbl_slope_y)
        coef_row.addWidget(self.spin_y, 1)
        coef_row.addWidget(self.lbl_slope_z)
        coef_row.addWidget(self.spin_z, 1)
        left_col.addLayout(coef_row)

        # Action buttons — two rows, tight
        self.btn_run = QtWidgets.QPushButton("Process")
        self.btn_run_plate_type = QtWidgets.QPushButton("Run Plate Type")
        self.btn_run_plate_type.setToolTip(
            "Runs the current coefficients across all devices of this plate type for all tests with meta, generating missing outputs."
        )
        self.btn_add_tests = QtWidgets.QPushButton("Add Tests")
        self.btn_reset_local = QtWidgets.QPushButton("Reset Local")
        self.btn_reset_local.setToolTip(
            "Delete all derived CSVs and orphan meta files (no matching raw CSV).\n"
            "Keeps raw CSVs and their meta files. Next sync re-trims and re-uploads."
        )

        btn_row1 = QtWidgets.QHBoxLayout()
        btn_row1.setSpacing(4)
        btn_row1.addWidget(self.btn_run, 1)
        btn_row1.addWidget(self.btn_run_plate_type, 1)
        left_col.addLayout(btn_row1)

        self.btn_thermal_drift = QtWidgets.QPushButton("Thermal Drift")
        self.btn_thermal_drift.setToolTip(
            "Plot signed error vs temperature for all tests of this plate type.\n"
            "Shows the raw shape of thermal drift before correction."
        )

        btn_row2 = QtWidgets.QHBoxLayout()
        btn_row2.setSpacing(4)
        btn_row2.addWidget(self.btn_add_tests, 1)
        btn_row2.addWidget(self.btn_reset_local, 1)
        btn_row2.addWidget(self.btn_thermal_drift, 1)
        left_col.addLayout(btn_row2)

        self.chk_auto_sync = QtWidgets.QCheckBox("Auto-sync")
        self.chk_auto_sync.setChecked(False)
        self.chk_auto_sync.setToolTip(
            "When enabled, background sync runs every 5 minutes.\n"
            "Manual sync via Refresh button always works regardless."
        )
        left_col.addWidget(self.chk_auto_sync)

        left_wrap = QtWidgets.QWidget()
        left_wrap.setLayout(left_col)

        # Middle column: display (runs picker + view + stage)
        middle_box = QtWidgets.QGroupBox("Display")
        middle_layout = QtWidgets.QVBoxLayout(middle_box)
        middle_layout.setSpacing(6)
        processed_label_row = QtWidgets.QHBoxLayout()
        processed_label = QtWidgets.QLabel("Processed Runs:")
        self.analysis_status_label = QtWidgets.QLabel()
        self.analysis_status_label.setVisible(False)
        processed_label_row.addWidget(processed_label)
        processed_label_row.addWidget(self.analysis_status_label, 0, QtCore.Qt.AlignRight)
        processed_label_row.addStretch(1)
        middle_layout.addLayout(processed_label_row)
        self.processed_list = QtWidgets.QListWidget()
        middle_layout.addWidget(self.processed_list, 1)
        controls_widget = QtWidgets.QWidget()
        controls_layout = QtWidgets.QHBoxLayout(controls_widget)
        controls_layout.setContentsMargins(0, 0, 0, 0)
        controls_layout.setSpacing(6)
        controls_layout.addWidget(QtWidgets.QLabel("Stage:"))
        controls_layout.addWidget(self.stage_combo)
        self.btn_plot_stages = QtWidgets.QPushButton("Plot")
        self.btn_plot_stages.setFixedWidth(60)
        self.btn_plot_stages.setToolTip("Show matplotlib visualization of stage detection windows")
        controls_layout.addWidget(self.btn_plot_stages)

        controls_layout.addWidget(QtWidgets.QLabel("Grading:"))
        self.grading_combo = QtWidgets.QComboBox()
        self.grading_combo.addItems(["Absolute", "Bias Controlled"])
        self.grading_combo.setToolTip(
            "Absolute: grade vs truth targets. Bias Controlled: grade vs room-temp baseline behavior."
        )
        controls_layout.addWidget(self.grading_combo)
        controls_layout.addStretch(1)
        
        middle_layout.addWidget(controls_widget, 0)

        # Right column: metrics
        right_box = QtWidgets.QGroupBox("Metrics")
        right_layout = QtWidgets.QVBoxLayout(right_box)
        self.metrics_widget = TempTestingMetricsWidget()
        right_layout.addWidget(self.metrics_widget, 1)

        root.addWidget(left_wrap, 1)
        root.addWidget(middle_box, 1)
        root.addWidget(right_box, 2)

        self.device_combo.currentTextChanged.connect(self._on_device_changed)
        self.btn_refresh.clicked.connect(self._on_refresh_clicked)
        self.btn_run.clicked.connect(self._on_run_clicked)
        self.btn_run_plate_type.clicked.connect(self._on_run_plate_type_clicked)
        self.btn_add_tests.clicked.connect(self._on_add_tests_clicked)
        self.btn_reset_local.clicked.connect(self._on_reset_local_clicked)
        self.btn_thermal_drift.clicked.connect(self._on_thermal_drift_clicked)
        self.test_list.currentItemChanged.connect(self._emit_test_changed)
        self.test_list.setContextMenuPolicy(QtCore.Qt.CustomContextMenu)
        self.test_list.customContextMenuRequested.connect(self._on_test_list_context_menu)
        self.processed_list.currentItemChanged.connect(self._emit_processed_changed)
        self.stage_combo.currentTextChanged.connect(lambda s: self.stage_changed.emit(str(s)))
        self.btn_plot_stages.clicked.connect(lambda: self.plot_stages_requested.emit())
        self.grading_combo.currentTextChanged.connect(lambda s: self.grading_mode_changed.emit(str(s)))
        try:
            self.metrics_widget.post_correction_changed.connect(self.post_correction_changed.emit)
        except Exception:
            pass

        self._processing_timer = QtCore.QTimer(self)
        self._processing_timer.setInterval(120)
        self._processing_timer.timeout.connect(self._on_spinner_tick)
        self._spinner_frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]
        self._spinner_index = 0
        self._processing_text = "Processing…"
        self._processing_active = False
        self._analysis_timer = QtCore.QTimer(self)
        self._analysis_timer.setInterval(140)
        self._analysis_timer.timeout.connect(self._on_analysis_spinner_tick)
        self._analysis_frames = ["◐", "◓", "◑", "◒"]
        self._analysis_index = 0
        self._analysis_active = False
        
        if self.controller:
            self.controller.tests_listed.connect(self.set_tests)
            self.controller.devices_listed.connect(self.set_devices)
            self.controller.processed_runs_loaded.connect(self.set_processed_runs)
            self.controller.stages_loaded.connect(self.set_stages)
            self.controller.test_meta_loaded.connect(self._on_test_meta_loaded)
            self.controller.processing_status.connect(self._on_processing_status)
            self.controller.analysis_status.connect(self._on_analysis_status)
            try:
                self.controller.bias_status.connect(self._on_bias_status)
            except Exception:
                pass
            self.test_changed.connect(self.controller.load_test_details)
            # Big picture: reset plate-type top3 (clear rollup cache)
            try:
                self.metrics_widget.btn_reset_top3.clicked.connect(self._on_reset_top3_clicked)
            except Exception:
                pass
            # Big picture: auto-search
            try:
                self.metrics_widget.btn_auto_search.clicked.connect(self._on_auto_search_clicked)
            except Exception:
                pass
            try:
                self.controller.rollup_ready.connect(self._on_rollup_ready)
            except Exception:
                pass
            try:
                self.controller.auto_search_status.connect(self._on_auto_search_status)
            except Exception:
                pass
            try:
                self.metrics_widget.top3_sort_changed.connect(self._on_top3_sort_changed)
            except Exception:
                pass
            try:
                self.controller.import_ready.connect(self._on_import_ready)
            except Exception:
                pass
            try:
                self.controller.auto_update_status.connect(self._on_auto_update_status)
            except Exception:
                pass
            try:
                self.controller.auto_update_done.connect(self._on_auto_update_done)
            except Exception:
                pass
            try:
                self.controller.thermal_drift_ready.connect(self._on_thermal_drift_ready)
            except Exception:
                pass

            # IMPORTANT: Do NOT auto-select and auto-run analysis on app startup.
            # We still allow explicit user-driven refresh via the Refresh button.
            self.chk_auto_sync.toggled.connect(self._on_auto_sync_toggled)
        self._bias_available = False
        self.set_bias_mode_available(False, "")
        self._current_device_id = ""
        self._current_plate_type = ""

    def post_correction_settings(self) -> tuple[bool, float]:
        try:
            return self.metrics_widget.post_correction_settings()
        except Exception:
            return False, 0.0

    def grading_mode(self) -> str:
        text = str(self.grading_combo.currentText() or "Absolute").strip().lower()
        return "bias" if text.startswith("bias") else "absolute"

    def set_bias_mode_available(self, available: bool, message: str = "") -> None:
        """
        Enable/disable the 'Bias Controlled' grading option.
        When disabling, forces selection back to Absolute.
        """
        self._bias_available = bool(available)
        try:
            model = self.grading_combo.model()
            item = model.item(1) if model is not None else None  # index 1 = Bias Controlled
            if item is not None:
                item.setEnabled(bool(available))
        except Exception:
            pass

        if not available:
            try:
                self.grading_combo.blockSignals(True)
                self.grading_combo.setCurrentIndex(0)
            finally:
                try:
                    self.grading_combo.blockSignals(False)
                except Exception:
                    pass

        if message:
            try:
                QtWidgets.QMessageBox.warning(self, "Bias-Controlled Grading", str(message))
            except Exception:
                pass

    def _on_bias_status(self, payload: dict) -> None:
        payload = payload or {}
        available = bool(payload.get("available"))
        message = str(payload.get("message") or "")
        self.set_bias_mode_available(available, message)
        # Update bias baseline health table when cache is available.
        if available and self.controller:
            try:
                self.metrics_widget.set_bias_cache(self.controller.bias_cache())
            except Exception:
                pass

    def _on_run_plate_type_clicked(self) -> None:
        """
        Run the current coefficient settings across all devices/tests for this plate type.
        """
        if not self.controller:
            return
        try:
            x, y, z = self.slopes()
            coefs = {"x": float(x), "y": float(y), "z": float(z)}
            self.metrics_widget.set_big_picture_status("Running batch rollup…")
            self.controller.run_coefs_across_plate_type(coefs, "scalar")
        except Exception as exc:
            try:
                QtWidgets.QMessageBox.warning(self, "Batch Rollup", str(exc))
            except Exception:
                pass

    def _on_reset_top3_clicked(self) -> None:
        """
        Clear the stored plate-type rollup that feeds the Top-3 list.
        This can be expensive to regenerate, so we always confirm.
        """
        if not self.controller:
            return

        pt = ""
        try:
            pt = str(self.controller.current_plate_type() or "").strip()
        except Exception:
            pt = ""

        title = "Confirm Reset"
        msg = (
            "This will clear the stored plate-type rollup used to compute the Top 3 coef combos.\n\n"
            "Regenerating it can take a lot of compute.\n\n"
            f"Plate type: {pt or '—'}"
        )
        reply = QtWidgets.QMessageBox.question(
            self,
            title,
            msg,
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.No,
        )
        if reply != QtWidgets.QMessageBox.Yes:
            return

        try:
            self.metrics_widget.set_big_picture_status("Clearing rollup…")
        except Exception:
            pass
        # Clear UI immediately; we'll refresh from disk when the controller emits rollup_ready.
        try:
            self.metrics_widget.set_top3([], [])
        except Exception:
            pass
        self.controller.reset_rollup_for_current_plate_type(backup=True)

    def _on_auto_search_clicked(self) -> None:
        """
        Run auto-search for the current plate type.
        """
        if not self.controller:
            return
        mode = "unified"
        try:
            text = str(self.metrics_widget.auto_search_combo.currentText() or "").strip().lower()
            if text.startswith("unified") and "k" not in text:
                mode = "unified"
            elif text.startswith("distinct"):
                mode = "distinct"
            elif text.startswith("stage") or "unified + k" in text:
                mode = "stage_split"
        except Exception:
            mode = "unified"
        try:
            self.metrics_widget.btn_auto_search.setEnabled(False)
        except Exception:
            pass
        try:
            self.metrics_widget.set_big_picture_status("Auto search running…")
            self.metrics_widget.set_search_progress(visible=True)
        except Exception:
            pass
        self.controller.run_auto_search_for_current_plate_type(search_mode=mode, mode="scalar")

    def _on_auto_search_status(self, payload: dict) -> None:
        payload = payload or {}
        status = str(payload.get("status") or "").lower()
        msg = str(payload.get("message") or "")
        if msg:
            try:
                self.metrics_widget.set_big_picture_status(msg)
            except Exception:
                pass
        # Update progress bars if present in payload.
        if "device_total" in payload:
            try:
                self.metrics_widget.set_search_progress(
                    device_index=int(payload.get("device_index", 0)),
                    device_total=int(payload.get("device_total", 0)),
                    test_index=int(payload.get("test_index", 0)),
                    test_total=int(payload.get("test_total", 0)),
                    visible=True,
                )
            except Exception:
                pass
        if status in ("completed", "error") and payload.get("search_done"):
            try:
                self.metrics_widget.set_search_progress(visible=False)
            except Exception:
                pass
            try:
                self.metrics_widget.btn_auto_search.setEnabled(True)
            except Exception:
                pass

    def _on_rollup_ready(self, payload: dict) -> None:
        payload = payload or {}
        ok = bool(payload.get("ok"))
        msg = str(payload.get("message") or "")
        errs = list(payload.get("errors") or [])

        # Auto-search reports
        report = payload.get("report") if isinstance(payload, dict) else None
        if isinstance(report, dict):
            try:
                kind = str(report.get("kind") or "").strip().lower()
                if kind == "distinct":
                    summary_path = str(report.get("summary_path") or "")
                    per_test_path = str(report.get("per_test_path") or "")
                    if summary_path or per_test_path:
                        details = "\n".join([p for p in [summary_path, per_test_path] if p])
                        QtWidgets.QMessageBox.information(self, "Distinct Coefs Report", details or "Report exported.")
                elif kind == "stage_split":
                    csv_path = str(report.get("csv_path") or "")
                    if csv_path:
                        QtWidgets.QMessageBox.information(self, "Unified + k Report", csv_path)
            except Exception:
                pass

        summary = payload.get("summary") if isinstance(payload, dict) else None
        if isinstance(summary, dict):
            try:
                self.set_unified_k_summary(summary)
            except Exception:
                pass

        if ok:
            self.metrics_widget.set_big_picture_status(msg or "Batch rollup complete")
            try:
                self._refresh_big_picture()
            except Exception:
                pass
        else:
            details = "\n".join([msg] + [f"- {e}" for e in errs if e])
            self.metrics_widget.set_big_picture_status("Batch rollup failed")
            try:
                QtWidgets.QMessageBox.warning(self, "Batch Rollup", details or "Batch rollup failed.")
            except Exception:
                pass

    def set_devices(self, devices: list[str]) -> None:
        self.device_combo.blockSignals(True)
        self.device_combo.clear()
        self.device_combo.addItems(devices)
        # Avoid implicit selection which would cascade into test selection and analysis.
        try:
            self.device_combo.setCurrentIndex(-1)
        except Exception:
            pass
        self.device_combo.blockSignals(False)
        # Clear dependent UI when device list changes.
        try:
            self.test_list.clear()
            self.processed_list.clear()
            self._clear_metrics()
        except Exception:
            pass
        try:
            self.test_changed.emit("")
        except Exception:
            pass

    def set_device_id(self, device_id: str) -> None:
        self.lbl_device_id.setText(device_id or "—")

    def set_model_label(self, model_text: str) -> None:
        self.lbl_model.setText(model_text or "—")

    def set_body_weight_n(self, bw_n: Optional[float]) -> None:
        try:
            if bw_n is None:
                self.lbl_bw.setText("—")
            else:
                self.lbl_bw.setText(f"{float(bw_n):.1f}")
        except Exception:
            self.lbl_bw.setText("—")

    def set_tests(self, files: list[str]) -> None:
        # Sort files by avg_temp (baselines first, then ascending temp).
        def _sort_key(f: str):
            meta = self._load_meta_for_csv(f)
            temp = self._extract_temperature_value(meta) if meta else None
            # None temps sort to the end.
            return (0 if temp is None else 1, temp if temp is not None else 999)

        sorted_files = sorted((f for f in (files or []) if f), key=_sort_key)

        items = []
        available = self._available_label_width()
        for f in sorted_files:
            label = self._build_test_label(f, available)
            items.append((label, f))
        if not items and files:
            items = [(os.path.basename(f.rstrip("\\/")), f) for f in files if f]
        self.set_tests_with_labels(items)

    def set_tests_with_labels(self, items: list[tuple[str, str]]) -> None:
        self.test_list.clear()
        available = self._available_label_width()
        for label, path in items:
            display = self._build_test_label(path, available) if path else label
            item = QtWidgets.QListWidgetItem(display)
            item.setData(QtCore.Qt.UserRole, path)  # store full path
            # Color baseline rows green.
            if path:
                meta = self._load_meta_for_csv(path)
                temp = self._extract_temperature_value(meta) if meta else None
                if self._is_baseline_temp(temp):
                    item.setForeground(QtGui.QColor("#2e9e2e"))
            self.test_list.addItem(item)
        # Do not auto-select the first test; user must explicitly pick one.
        if self.test_list.count() == 0:
            self.test_changed.emit("")
        self._refresh_test_labels()

    def set_stages(self, stages: list[str]) -> None:
        stages = stages or ["All"]
        if "All" not in stages:
            stages = ["All"] + [s for s in stages if s != "All"]
        self.stage_combo.blockSignals(True)
        self.stage_combo.clear()
        self.stage_combo.addItems(stages)
        self.stage_combo.blockSignals(False)

    def set_processed_runs(self, entries: list[dict]) -> None:
        self.processed_list.clear()
        for e in entries or []:
            if e.get("is_baseline"):
                continue
            label = e.get("label") or e.get("path") or ""
            mode = str(e.get("mode") or "").capitalize()
            if mode == "Legacy":
                # Scalar is the default/normal mode; only tag legacy runs so they stand out.
                label = f"{label} [{mode}]"
            elif not mode:
                # If no meta exists, assume legacy (backwards compatibility) and avoid tagging.
                pass
                
            path = str(e.get("path") or "")

            it = QtWidgets.QListWidgetItem()
            it.setData(QtCore.Qt.UserRole, dict(e))
            self.processed_list.addItem(it)
            
            widget = ProcessedRunItemWidget(str(label), path, it, self.processed_list)
            widget.delete_requested.connect(self._on_delete_processed_requested)
            
            it.setSizeHint(widget.sizeHint())
            self.processed_list.setItemWidget(it, widget)

        # Do not auto-select a processed run. Selecting one triggers analysis which
        # should only happen on explicit user action.
        if self.processed_list.count() == 0:
            try:
                self._clear_metrics()
            except Exception:
                pass

    def selected_test(self) -> str:
        it = self.test_list.currentItem()
        return str(it.data(QtCore.Qt.UserRole)) if it is not None else ""

    def slopes(self) -> tuple[float, float, float]:
        return float(self.spin_x.value()), float(self.spin_y.value()), float(self.spin_z.value())

    def current_stage(self) -> str:
        """Return current stage selection: 'All', 'db', or 'bw'."""
        text = str(self.stage_combo.currentText() or "All").strip()
        if text.lower().startswith("45") or text.lower() == "db":
            return "db"
        elif text.lower().startswith("body") or text.lower() == "bw":
            return "bw"
        return "All"

    def set_analysis_metrics(
        self,
        payload: dict,
        *,
        device_type: str = "06",
        body_weight_n: float = 0.0,
        bias_cache: Optional[dict] = None,
        bias_map_all=None,
        grading_mode: str = "absolute",
    ) -> None:
        """
        Update the metrics widget from analysis results.
        """
        try:
            self.metrics_widget.set_bias_cache(bias_cache)
            self.metrics_widget.set_run_metrics(
                payload,
                device_type=str(device_type or "06"),
                body_weight_n=float(body_weight_n or 0.0),
                bias_map_all=bias_map_all,
                grading_mode=str(grading_mode or "absolute"),
            )
        except Exception:
            try:
                self.metrics_widget.clear()
            except Exception:
                pass

    def set_unified_k_summary(self, summary: Optional[dict]) -> None:
        # Unified + k grading is strictly bias-controlled.
        show = summary
        try:
            if isinstance(summary, dict) and isinstance(summary.get("bias"), dict):
                show = {
                    "coef": summary.get("coef"),
                    "coef_key": summary.get("coef_key"),
                    "k": summary.get("k"),
                    **dict(summary.get("bias") or {}),
                }
        except Exception:
            show = summary

        try:
            self.metrics_widget.set_unified_k_summary(show)
        except Exception:
            pass
        try:
            k = summary.get("k") if isinstance(summary, dict) else None
            if k is not None:
                self.metrics_widget.set_post_correction_k(float(k))
        except Exception:
            pass

    def _on_delete_processed_requested(self, file_path: str) -> None:
        if not file_path:
            return

        reply = QtWidgets.QMessageBox.question(
            self,
            "Confirm Delete",
            "Are you sure you want to delete this processed run?\nOnly this file will be deleted.",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.No
        )
        if reply == QtWidgets.QMessageBox.Yes:
            if self.controller:
                self.controller.delete_processed_run(file_path)

    def _on_run_clicked(self) -> None:
        payload = {
            "mode": "scalar",
            "device_id": self.device_combo.currentText().strip(),
            "csv_path": self.selected_test(),
            "slopes": {"x": float(self.spin_x.value()), "y": float(self.spin_y.value()), "z": float(self.spin_z.value())},
        }
        if self.controller:
            self.controller.run_processing(payload)
        else:
            self.run_requested.emit(payload)

    def _on_add_tests_clicked(self) -> None:
        if not self.controller:
            return
        files, _filter = QtWidgets.QFileDialog.getOpenFileNames(
            self,
            "Add Temperature Tests",
            "",
            "Temperature Raw (temp-raw-*.csv;*.meta.json);;CSV Files (*.csv);;Meta JSON (*.meta.json);;All Files (*.*)",
        )
        files = list(files or [])
        if not files:
            return
        self.metrics_widget.set_big_picture_status(f"Importing {len(files)} file(s)…")
        self.controller.import_temperature_tests(files)

    def _on_auto_sync_toggled(self, checked: bool) -> None:
        if self.controller:
            self.controller._auto_sync_enabled = checked

    def _on_thermal_drift_clicked(self) -> None:
        if not self.controller:
            return
        current_dev = self.device_combo.currentText().strip() if self.device_combo.currentIndex() >= 0 else ""
        if current_dev:
            items = ["All devices", current_dev]
            choice, ok = QtWidgets.QInputDialog.getItem(
                self, "Thermal Drift", "Scope:", items, 0, False)
            if not ok:
                return
            if choice == current_dev:
                self.controller.plot_thermal_drift(device_id=current_dev)
                return
        self.controller.plot_thermal_drift()

    @staticmethod
    def _aggregate_per_test(points: list, stage: str, key: str) -> tuple:
        """Average *key* across cells for each (capture, device) test.

        Returns ``(temps, means)`` — one value per test.
        """
        from collections import defaultdict
        buckets: dict[str, list] = defaultdict(list)  # capture → [values]
        temp_for: dict[str, float] = {}
        for p in points:
            if p["stage"] != stage or p.get(key) is None:
                continue
            c = p["capture"]
            buckets[c].append(p[key])
            temp_for[c] = p["temp_f"]
        temps, means = [], []
        for c, vals in buckets.items():
            temps.append(temp_for[c])
            means.append(sum(vals) / len(vals))
        return temps, means

    def _on_thermal_drift_ready(self, payload: dict) -> None:
        """Plot per-test mean signed error vs temperature with trend lines."""
        import numpy as np

        points = payload.get("points") or []
        errors = payload.get("errors") or []

        if errors:
            import logging
            logging.getLogger(__name__).warning("Thermal drift errors: %s", errors[:10])

        if not points:
            QtWidgets.QMessageBox.warning(self, "Thermal Drift", "No measurement points found.")
            return

        try:
            from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas
            from matplotlib.backends.backend_qtagg import NavigationToolbar2QT as NavToolbar
            from matplotlib.figure import Figure

            dlg = QtWidgets.QDialog(self)
            plate = self._current_plate_type or "?"
            single_dev = payload.get("device_id")
            title_scope = f"Device {single_dev}" if single_dev else f"Plate Type {plate}"
            dlg.setWindowTitle(f"Thermal Drift \u2014 {title_scope}")
            dlg.resize(1300, 800)
            layout = QtWidgets.QVBoxLayout(dlg)
            layout.setContentsMargins(4, 4, 4, 4)

            fig = Figure(figsize=(14, 9))
            canvas = FigureCanvas(fig)
            toolbar = NavToolbar(canvas, dlg)
            layout.addWidget(toolbar)
            layout.addWidget(canvas)

            # 2x2: left=raw, right=bias-adjusted; top=DB, bottom=BW
            ax_db_raw = fig.add_subplot(2, 2, 1)
            ax_db_adj = fig.add_subplot(2, 2, 2, sharey=ax_db_raw)
            ax_bw_raw = fig.add_subplot(2, 2, 3, sharex=ax_db_raw)
            ax_bw_adj = fig.add_subplot(2, 2, 4, sharex=ax_db_adj, sharey=ax_bw_raw)

            def _plot_with_trend(ax, temps, means, color, title):
                from scipy import stats as sp_stats
                n = len(temps)
                if n > 0:
                    ax.scatter(temps, means, s=30, alpha=0.7, c=color, edgecolors="none", zorder=2)
                    if n >= 2:
                        t_arr = np.array(temps)
                        m_arr = np.array(means)
                        coeffs = np.polyfit(t_arr, m_arr, 1)
                        r_val, p_val = sp_stats.pearsonr(t_arr, m_arr) if n >= 3 else (float("nan"), float("nan"))
                        r_sq = r_val ** 2
                        t_line = np.linspace(t_arr.min(), t_arr.max(), 100)
                        ax.plot(t_line, np.polyval(coeffs, t_line), color="k",
                                linewidth=1.5, linestyle="--", alpha=0.8, zorder=3,
                                label=f"slope={coeffs[0]:.3f} %/\u00b0F\nr={r_val:.3f}  R\u00b2={r_sq:.3f}  p={p_val:.2e}")
                        ax.legend(fontsize=8, loc="best")
                ax.axhline(0, color="k", linewidth=0.5)
                ax.set_title(f"{title}  ({n} tests)")
                ax.grid(True, alpha=0.3)

            # Per-test averages
            db_raw_t, db_raw_m = self._aggregate_per_test(points, "db", "signed_pct")
            db_adj_t, db_adj_m = self._aggregate_per_test(points, "db", "bias_adj_pct")
            bw_raw_t, bw_raw_m = self._aggregate_per_test(points, "bw", "signed_pct")
            bw_adj_t, bw_adj_m = self._aggregate_per_test(points, "bw", "bias_adj_pct")

            _plot_with_trend(ax_db_raw, db_raw_t, db_raw_m, "tab:blue", "DB \u2014 Raw")
            _plot_with_trend(ax_db_adj, db_adj_t, db_adj_m, "tab:cyan", "DB \u2014 Bias Adjusted")
            _plot_with_trend(ax_bw_raw, bw_raw_t, bw_raw_m, "tab:orange", "BW \u2014 Raw")
            _plot_with_trend(ax_bw_adj, bw_adj_t, bw_adj_m, "tab:red", "BW \u2014 Bias Adjusted")

            ax_db_raw.set_ylabel("Mean Signed Error (%)")
            ax_bw_raw.set_ylabel("Mean Signed Error (%)")
            ax_bw_raw.set_xlabel("Temperature (\u00b0F)")
            ax_bw_adj.set_xlabel("Temperature (\u00b0F)")

            fig.tight_layout()
            canvas.draw()

            dlg.show()
            if not hasattr(self, "_drift_dialogs"):
                self._drift_dialogs = []
            self._drift_dialogs.append(dlg)
            dlg.finished.connect(lambda: self._drift_dialogs.remove(dlg) if dlg in self._drift_dialogs else None)

        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "Thermal Drift", f"Plot failed: {exc}")

    def _on_reset_local_clicked(self) -> None:
        """Delete derived files and orphan metas. Keep raw CSVs + their metas."""
        reply = QtWidgets.QMessageBox.question(
            self,
            "Reset Local Files",
            "This will:\n"
            "  - Delete all trimmed, processed, and scalar CSVs\n"
            "  - Delete meta files that have no matching raw CSV\n"
            "  - Clear sync stamps on remaining meta files\n\n"
            "Raw CSVs and their meta files are preserved.\n"
            "Next sync will re-trim from raw and re-upload.\n\n"
            "Continue?",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.No,
        )
        if reply != QtWidgets.QMessageBox.Yes:
            return

        import glob

        root = ""
        if self.controller:
            try:
                root = self.controller.temp_testing_root()
            except Exception:
                pass
        if not root or not os.path.isdir(root):
            QtWidgets.QMessageBox.warning(self, "Reset", "Could not locate temp_testing folder.")
            return

        trimmed_deleted = 0
        processed_deleted = 0
        meta_cleared = 0
        orphan_meta_deleted = 0

        # Step 1: Build whitelist of raw stems per device directory.
        raw_stems: set = set()  # (device_dir, stem) pairs
        for device_dir_name in os.listdir(root):
            device_dir = os.path.join(root, device_dir_name)
            if not os.path.isdir(device_dir):
                continue
            for f in os.listdir(device_dir):
                if f.startswith("temp-raw-") and f.lower().endswith(".csv"):
                    stem = f[:-4]  # strip .csv
                    raw_stems.add((device_dir, stem))

        # Step 2: Delete trimmed, processed, scalar CSVs (regenerated from raw).
        for pattern in ("temp-trimmed-*.csv", "temp-processed-*.csv", "temp-scalar-*.csv"):
            for f in glob.glob(os.path.join(root, "*", pattern)):
                try:
                    os.remove(f)
                    if "trimmed" in pattern:
                        trimmed_deleted += 1
                    else:
                        processed_deleted += 1
                except Exception:
                    pass

        # Step 3: Delete bias cache files.
        for f in glob.glob(os.path.join(root, "*", "temp-baseline-bias.json")):
            try:
                os.remove(f)
            except Exception:
                pass

        # Step 4: Handle meta files — keep only those with a matching raw CSV.
        for meta_path in glob.glob(os.path.join(root, "*", "*.meta.json")):
            device_dir = os.path.dirname(meta_path)
            fname = os.path.basename(meta_path)
            if not fname.endswith(".meta.json"):
                continue
            stem = fname[: -len(".meta.json")]

            if (device_dir, stem) not in raw_stems:
                # Orphan meta (no local raw file) — delete it.
                try:
                    os.remove(meta_path)
                    orphan_meta_deleted += 1
                except Exception:
                    pass
                continue

            # Has a raw file — strip sync stamps so it re-uploads cleanly.
            try:
                with open(meta_path, "r", encoding="utf-8") as fh:
                    meta = json.load(fh)
                changed = False
                if "synced_at_ms" in meta:
                    del meta["synced_at_ms"]
                    changed = True
                if "processed_baseline" in meta:
                    del meta["processed_baseline"]
                    changed = True
                if changed:
                    with open(meta_path, "w", encoding="utf-8") as fh:
                        json.dump(meta, fh, indent=2, sort_keys=True)
                    meta_cleared += 1
            except Exception:
                pass

        summary = (
            f"Deleted {trimmed_deleted} trimmed and {processed_deleted} processed CSVs.\n"
            f"Deleted {orphan_meta_deleted} orphan meta files (no matching raw CSV).\n"
            f"Cleared sync stamps on {meta_cleared} meta files.\n\n"
            "Run a sync or restart to re-trim and re-upload."
        )
        QtWidgets.QMessageBox.information(self, "Reset Complete", summary)

        # Refresh UI
        if self.controller:
            try:
                self.controller.refresh_devices()
            except Exception:
                pass

    def _on_import_ready(self, payload: dict) -> None:
        payload = payload or {}
        imported = int(payload.get("imported") or 0)
        skipped = int(payload.get("skipped") or 0)
        errors = list(payload.get("errors") or [])
        affected_devices = list(payload.get("affected_devices") or [])
        affected_plate_types = list(payload.get("affected_plate_types") or [])

        summary = f"Imported: {imported}\nSkipped (already exists): {skipped}"
        if errors:
            summary = summary + "\n\nErrors:\n" + "\n".join([f"- {e}" for e in errors if e])

        try:
            QtWidgets.QMessageBox.information(self, "Add Tests", summary)
        except Exception:
            pass

        if imported <= 0:
            self.metrics_widget.set_big_picture_status("Import complete")
            return

        # Refresh device list/tests since temp_testing folders may have changed.
        try:
            self.controller.refresh_devices()
        except Exception:
            pass
        try:
            if self._current_device_id:
                self.controller.refresh_tests(self._current_device_id)
        except Exception:
            pass

        # Ask for auto-update metrics.
        title = "Auto Update Metrics"
        msg = (
            "Import complete.\n\n"
            "Run auto-update metrics now?\n\n"
            "- Resets plate-type rollups\n"
            "- Recomputes bias caches from room-temp baselines\n"
            "- Runs unified auto-search for each affected plate type\n\n"
            f"Affected plate types: {', '.join(affected_plate_types) if affected_plate_types else '—'}"
        )
        reply = QtWidgets.QMessageBox.question(
            self,
            title,
            msg,
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
            QtWidgets.QMessageBox.No,
        )
        if reply != QtWidgets.QMessageBox.Yes:
            self.metrics_widget.set_big_picture_status("Import complete (no auto-update)")
            # Still refresh big picture with whatever exists now.
            try:
                self._refresh_big_picture()
            except Exception:
                pass
            return

        # Kick off auto-update (implemented next step).
        self.metrics_widget.set_big_picture_status("Auto-update queued…")
        try:
            self.controller.run_auto_update_metrics(affected_plate_types, affected_devices)
        except Exception as exc:
            try:
                QtWidgets.QMessageBox.warning(self, "Auto Update Metrics", str(exc))
            except Exception:
                pass

    def _on_auto_update_status(self, payload: dict) -> None:
        payload = payload or {}
        msg = str(payload.get("message") or "")
        if msg:
            try:
                self.metrics_widget.set_big_picture_status(msg)
            except Exception:
                pass

    def _on_auto_update_done(self, payload: dict) -> None:
        payload = payload or {}
        ok = bool(payload.get("ok"))
        msg = str(payload.get("message") or "")
        errs = list(payload.get("errors") or [])
        if msg:
            try:
                self.metrics_widget.set_big_picture_status(msg)
            except Exception:
                pass
        if not ok and errs:
            details = "\n".join([msg] + [f"- {e}" for e in errs if e])
            try:
                QtWidgets.QMessageBox.warning(self, "Auto Update Metrics", details or "Auto-update failed.")
            except Exception:
                pass
        # Refresh Big Picture + bias cache for current device after auto-update.
        try:
            self._refresh_big_picture()
        except Exception:
            pass
        try:
            if self.controller and self._current_device_id:
                loaded = bool(self.controller.load_bias_cache_for_device(self._current_device_id))
                self.metrics_widget.set_bias_cache(self.controller.bias_cache() if loaded else None)
        except Exception:
            pass

    def _on_refresh_clicked(self) -> None:
        if self.controller:
            # Kick off a background sync (upload pending + download new).
            try:
                self.controller.force_background_sync()
            except Exception:
                pass
            # Refresh the device list first (safe, does not trigger analysis).
            try:
                self.controller.refresh_devices()
            except Exception:
                pass
            # If a device is already selected, refresh its tests too.
            try:
                device_id = self.device_combo.currentText().strip()
            except Exception:
                device_id = ""
            if device_id:
                self.controller.refresh_tests(device_id)
        else:
            self.refresh_requested.emit()

    def _emit_test_changed(self) -> None:
        it = self.test_list.currentItem()
        path = str(it.data(QtCore.Qt.UserRole)) if it is not None else ""
        self.test_changed.emit(path)

    def _on_test_list_context_menu(self, pos) -> None:
        item = self.test_list.itemAt(pos)
        if item is None:
            return
        raw_path = str(item.data(QtCore.Qt.UserRole) or "")
        if not raw_path:
            return

        selected = self.test_list.selectedItems()
        multi = len(selected) > 1

        menu = QtWidgets.QMenu(self)
        if not multi:
            act_files = menu.addAction("Files...")
        else:
            act_files = None
        act_revert = menu.addAction(
            f"Revert Temp Correction ({len(selected)})" if multi
            else "Revert Temp Correction"
        )
        act_undo_revert = menu.addAction(
            f"Undo Temp Correction Revert ({len(selected)})" if multi
            else "Undo Temp Correction Revert"
        )
        menu.addSeparator()
        act_delete = menu.addAction(
            f"Delete Tests ({len(selected)})" if multi else "Delete Test"
        )

        chosen = menu.exec_(self.test_list.viewport().mapToGlobal(pos))
        if chosen is None:
            return
        if chosen == act_files:
            svc = getattr(self.controller, "testing", None) if self.controller else None
            dlg = TestFilesDialog(raw_path, parent=self, testing_service=svc)
            dlg.setAttribute(QtCore.Qt.WA_DeleteOnClose)
            dlg.show()
        elif chosen == act_revert:
            paths = [str(it.data(QtCore.Qt.UserRole) or "") for it in selected]
            self._batch_revert_temp_correction([p for p in paths if p], undo=False)
        elif chosen == act_undo_revert:
            paths = [str(it.data(QtCore.Qt.UserRole) or "") for it in selected]
            self._batch_revert_temp_correction([p for p in paths if p], undo=True)
        elif chosen == act_delete:
            if multi:
                paths = [str(it.data(QtCore.Qt.UserRole) or "") for it in selected]
                reply = QtWidgets.QMessageBox.question(
                    self, "Delete Tests",
                    f"Permanently delete {len(paths)} tests?",
                    QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
                )
                if reply == QtWidgets.QMessageBox.Yes:
                    for p in paths:
                        if p:
                            self._delete_test(p, confirm=False)
            else:
                self._delete_test(raw_path)

    def _plot_test_z_axis(self, raw_csv_path: str) -> None:
        """Plot Z-axis force data from the processed-off CSV for a test."""
        folder = os.path.dirname(raw_csv_path)
        filename = os.path.basename(raw_csv_path)

        # Derive the processed-off and trimmed filenames from the raw CSV name.
        if filename.startswith("temp-raw-"):
            base = filename[len("temp-raw-"):]
            processed_name = f"temp-processed-{base}"
            trimmed_name = f"temp-trimmed-{base}"
        else:
            processed_name = filename
            trimmed_name = filename

        # Try processed first, then trimmed, then raw.
        candidates = [
            os.path.join(folder, processed_name),
            os.path.join(folder, trimmed_name),
            raw_csv_path,
        ]
        csv_to_plot = None
        for c in candidates:
            if os.path.isfile(c):
                csv_to_plot = c
                break

        if not csv_to_plot:
            QtWidgets.QMessageBox.warning(self, "Plot", "No CSV file found on disk for this test.")
            return

        try:
            from ..widgets.temp_stage_plotter import _load_csv_data
            import matplotlib.pyplot as plt

            times, fz = _load_csv_data(csv_to_plot)
            if not times:
                QtWidgets.QMessageBox.warning(self, "Plot", f"No Z-axis data found in {os.path.basename(csv_to_plot)}")
                return

            # Normalize time to start at 0
            t0 = times[0] if times and times[0] == times[0] else 0.0
            times = [(t - t0) if (t == t) else t for t in times]

            fig, ax = plt.subplots(figsize=(12, 5))
            fig.canvas.manager.set_window_title(f"Z-axis: {os.path.basename(csv_to_plot)}")
            ax.plot(times, fz, "b-", linewidth=0.8, alpha=0.8)
            ax.set_title(os.path.basename(csv_to_plot))
            ax.set_xlabel("Time (ms)")
            ax.set_ylabel("Force Z (N)")
            ax.grid(True, alpha=0.3)
            ax.axhline(0, color="k", linewidth=0.5)
            plt.tight_layout()
            plt.show()
        except Exception as exc:
            QtWidgets.QMessageBox.warning(self, "Plot", f"Failed to plot: {exc}")

    def _batch_revert_temp_correction(self, raw_paths: list[str], *, undo: bool = False) -> None:
        """Revert (or undo revert of) baked temp correction for multiple tests."""
        import glob as _glob
        from ...app_services.temperature_processing_service import revert_baked_temp_correction

        action = "Undo revert" if undo else "Revert"
        reply = QtWidgets.QMessageBox.question(
            self, "Batch Temp Correction",
            f"{action} baked temperature correction for {len(raw_paths)} test(s)?\n\n"
            "This modifies each trimmed CSV, deletes processed files, and reprocesses baselines.",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
        )
        if reply != QtWidgets.QMessageBox.Yes:
            return

        ok_count = 0
        errors: list[str] = []
        for raw_path in raw_paths:
            filename = os.path.basename(raw_path)
            device_dir = os.path.dirname(raw_path)
            device_id = os.path.basename(device_dir)
            capture_name = os.path.splitext(filename)[0]

            if filename.startswith("temp-raw-"):
                base = filename[len("temp-raw-"):-4] if filename.lower().endswith(".csv") else filename[len("temp-raw-"):]
            else:
                base = os.path.splitext(filename)[0]
            trimmed_path = os.path.join(device_dir, f"temp-trimmed-{base}.csv")
            meta_path = os.path.join(device_dir, f"{capture_name}.meta.json")

            if not os.path.isfile(trimmed_path):
                errors.append(f"{base}: no trimmed CSV")
                continue

            # Check current flag to avoid double-revert.
            meta = {}
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as fh:
                        meta = json.load(fh) or {}
                except Exception:
                    meta = {}
            already_reverted = bool(meta.get("temp_correction_reverted", False))
            if not undo and already_reverted:
                errors.append(f"{base}: already reverted")
                continue
            if undo and not already_reverted:
                errors.append(f"{base}: not reverted")
                continue

            try:
                revert_baked_temp_correction(trimmed_path, device_id, room_temp_f=76.0, undo=undo)
            except Exception as exc:
                errors.append(f"{base}: {exc}")
                continue

            # Delete processed / scalar files.
            suffix = capture_name.replace("temp-raw-", "", 1)
            for pattern in (f"temp-processed-{suffix}.csv", f"temp-scalar-*-{suffix}.csv"):
                for fp in _glob.glob(os.path.join(device_dir, pattern)):
                    try:
                        os.remove(fp)
                    except Exception:
                        pass

            # Update meta.
            meta["temp_correction_reverted"] = not undo
            meta.pop("synced_at_ms", None)
            meta.pop("processed_baseline", None)
            try:
                with open(meta_path, "w", encoding="utf-8") as fh:
                    json.dump(meta, fh, indent=2, sort_keys=True)
            except Exception:
                pass

            ok_count += 1

        # Summary.
        msg = f"{action} complete: {ok_count}/{len(raw_paths)} succeeded."
        if errors:
            msg += "\n\nSkipped/failed:\n" + "\n".join(f"  • {e}" for e in errors)
        QtWidgets.QMessageBox.information(self, "Batch Temp Correction", msg)

    def _delete_test(self, raw_csv_path: str, *, confirm: bool = True) -> None:
        """Delete a test locally and from Supabase."""
        import glob as _glob

        capture_name = os.path.splitext(os.path.basename(raw_csv_path))[0]
        if confirm:
            reply = QtWidgets.QMessageBox.question(
                self,
                "Delete Test",
                f"Permanently delete '{capture_name}' locally and from Supabase?\n\n"
                "This removes the raw CSV, all derived files, meta, and the Supabase record.\n"
                "This cannot be undone.",
                QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
                QtWidgets.QMessageBox.No,
            )
            if reply != QtWidgets.QMessageBox.Yes:
                return

        device_dir = os.path.dirname(raw_csv_path)
        # Derive all related local file patterns.
        # capture_name = "temp-raw-DEVICE-DATE-TIME"
        suffix = capture_name.replace("temp-raw-", "", 1)  # "DEVICE-DATE-TIME"

        deleted_files = 0
        for pattern in (
            f"temp-raw-{suffix}.csv",
            f"temp-raw-{suffix}.meta.json",
            f"temp-trimmed-{suffix}.csv",
            f"temp-processed-{suffix}.csv",
            f"temp-scalar-*-{suffix}.csv",
        ):
            for f in _glob.glob(os.path.join(device_dir, pattern)):
                try:
                    os.remove(f)
                    deleted_files += 1
                except Exception:
                    pass

        # Delete from Supabase.
        supabase_ok = False
        try:
            from ...infra.supabase_temp_repo import SupabaseTempRepository
            repo = SupabaseTempRepository()
            supabase_ok = repo.delete_session_fully(capture_name)
        except Exception:
            pass

        status = f"Deleted {deleted_files} local files."
        if supabase_ok:
            status += "\nSupabase record removed."
        else:
            status += "\nSupabase deletion skipped or failed."
        QtWidgets.QMessageBox.information(self, "Delete Test", status)

        # Refresh UI.
        if self.controller:
            try:
                device_id = self.device_combo.currentText().strip()
                if device_id:
                    self.controller.refresh_tests(device_id)
            except Exception:
                pass

    def _emit_processed_changed(self) -> None:
        it = self.processed_list.currentItem()
        data = dict(it.data(QtCore.Qt.UserRole)) if it is not None else {}
        if self.controller:
            self.controller.select_processed_run(data)
        self.processed_selected.emit(data)

    def _on_device_changed(self, text: str) -> None:
        device = str(text or "").strip()
        self._current_device_id = device
        try:
            self._current_plate_type = str(self.controller.plate_type_from_device_id(device) if self.controller else "")
        except Exception:
            self._current_plate_type = ""
        self.device_selected.emit(device)
        if not device:
            try:
                self.test_list.clear()
                self.processed_list.clear()
                self._clear_metrics()
            except Exception:
                pass
            try:
                self.test_changed.emit("")
            except Exception:
                pass
            return
        if self.controller:
            self.controller.refresh_tests(device)
            # Refresh Big Picture + Bias baseline health immediately on device selection.
            try:
                self._refresh_big_picture()
            except Exception:
                pass
            try:
                loaded = bool(self.controller.load_bias_cache_for_device(device))
                self.metrics_widget.set_bias_cache(self.controller.bias_cache() if loaded else None)
                if not loaded:
                    title = "Bias Baseline Health"
                    msg = "No bias cache found for this device.\n\nCompute bias now?"
                    reply = QtWidgets.QMessageBox.question(
                        self,
                        title,
                        msg,
                        QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No,
                        QtWidgets.QMessageBox.No,
                    )
                    if reply == QtWidgets.QMessageBox.Yes:
                        self.metrics_widget.set_big_picture_status("Computing bias baseline…")
                        self.controller.compute_bias_for_device(device)
            except Exception:
                pass

    def _refresh_big_picture(self) -> None:
        if not self.controller:
            return
        pt = str(self._current_plate_type or "").strip()
        if not pt:
            self.metrics_widget.set_top3([], [])
            return
        # Load cached Unified+k summary immediately on plate selection.
        try:
            summary = self.controller.unified_k_cached_summary_for_plate_type(pt)
            self.set_unified_k_summary(summary if isinstance(summary, dict) else None)
        except Exception:
            try:
                self.set_unified_k_summary(None)
            except Exception:
                pass
        data = self.controller.top3_for_plate_type(pt)
        rows_abs = list((data or {}).get("mean_abs") or [])
        rows_signed = list((data or {}).get("signed_abs") or [])
        self.metrics_widget.set_top3(rows_abs, rows_signed)

    def _on_top3_sort_changed(self, _mode: str) -> None:
        # Widget re-renders immediately; ensure its cached lists are fresh for current plate type.
        try:
            self._refresh_big_picture()
        except Exception:
            pass

    def _on_test_meta_loaded(self, meta: dict) -> None:
        if not isinstance(meta, dict):
            return
        bw = meta.get("body_weight_n")
        self.set_body_weight_n(bw if bw is not None else None)
        device = meta.get("device_id")
        if device:
            self.set_device_id(device)

    def _on_processing_status(self, payload: dict) -> None:
        payload = payload or {}
        status = str(payload.get("status") or "").lower()
        message = str(payload.get("message") or "Processing…")
        if status == "running":
            self._start_processing_ui(message)
        else:
            self._stop_processing_ui()
            if status == "error":
                try:
                    QtWidgets.QMessageBox.warning(self, "Temperature Processing", message)
                except Exception:
                    pass

    def _start_processing_ui(self, message: str) -> None:
        self._processing_text = message or "Processing…"
        self._processing_active = True
        self._spinner_index = 0
        self.btn_run.setEnabled(False)
        self._processing_timer.start()
        self.btn_run.setText(f"{self._spinner_frames[self._spinner_index]} {self._processing_text}")

    def _stop_processing_ui(self) -> None:
        if not self._processing_active:
            return
        self._processing_active = False
        self._processing_timer.stop()
        self.btn_run.setEnabled(True)
        self.btn_run.setText("Process")

    def _on_spinner_tick(self) -> None:
        if not self._processing_active:
            return
        self._spinner_index = (self._spinner_index + 1) % len(self._spinner_frames)
        self.btn_run.setText(f"{self._spinner_frames[self._spinner_index]} {self._processing_text}")

    def eventFilter(self, obj: QtCore.QObject, event: QtCore.QEvent) -> bool:
        viewport = self.test_list.viewport() if self.test_list else None
        if obj in (self.test_list, viewport) and event.type() == QtCore.QEvent.Resize:
            self._refresh_test_labels()
        return super().eventFilter(obj, event)

    def _on_analysis_status(self, payload: dict) -> None:
        payload = payload or {}
        status = str(payload.get("status") or "").lower()
        message = str(payload.get("message") or "")
        if status == "running":
            self._start_analysis_spinner(message or "Analyzing…")
        else:
            self._stop_analysis_spinner(message if status == "error" else "")

    def _start_analysis_spinner(self, message: str) -> None:
        self._analysis_active = True
        self._analysis_index = 0
        self.analysis_status_label.setVisible(True)
        self.analysis_status_label.setText(f"{self._analysis_frames[self._analysis_index]} {message}")
        self._analysis_timer.start()

    def _stop_analysis_spinner(self, message: str = "") -> None:
        if not self._analysis_active:
            if message:
                self.analysis_status_label.setText(message)
                self.analysis_status_label.setVisible(True)
            else:
                self.analysis_status_label.setVisible(False)
            return
        self._analysis_active = False
        self._analysis_timer.stop()
        if message:
            self.analysis_status_label.setText(message)
            self.analysis_status_label.setVisible(True)
        else:
            self.analysis_status_label.setVisible(False)

    def _on_analysis_spinner_tick(self) -> None:
        if not self._analysis_active:
            return
        self._analysis_index = (self._analysis_index + 1) % len(self._analysis_frames)
        text = self.analysis_status_label.text()
        message = text.split(" ", 1)[1] if " " in text else ""
        self.analysis_status_label.setText(f"{self._analysis_frames[self._analysis_index]} {message or 'Analyzing…'}")

    # --- helpers -------------------------------------------------------------

    def _refresh_test_labels(self) -> None:
        if not self.test_list or self.test_list.count() == 0:
            return
        available = self._available_label_width()
        for idx in range(self.test_list.count()):
            item = self.test_list.item(idx)
            path = item.data(QtCore.Qt.UserRole)
            label = self._build_test_label(path, available)
            item.setText(label)

    def _available_label_width(self) -> Optional[int]:
        try:
            viewport = self.test_list.viewport()
            width = viewport.width()
        except Exception:
            return None
        if width <= 0:
            return None
        # Leave some breathing room for scrollbar/padding
        return max(0, width - 24)

    def _is_baseline_temp(self, temp_val: Optional[float]) -> bool:
        from ... import config
        if temp_val is None:
            return False
        return config.TEMP_BASELINE_ROOM_TEMP_MIN_F <= temp_val <= config.TEMP_BASELINE_ROOM_TEMP_MAX_F

    def _build_test_label(self, csv_path: Optional[str], available_px: Optional[int] = None) -> str:
        if not csv_path:
            return ""
        base_name = os.path.basename(csv_path.rstrip("\\/"))
        meta = self._load_meta_for_csv(csv_path)
        if not meta:
            return base_name

        temp_val = self._extract_temperature_value(meta)
        temp_text = f"{temp_val:.1f}°F" if temp_val is not None else "—°F"
        badge = "[BL] " if self._is_baseline_temp(temp_val) else ""
        tester = str(meta.get("tester_name") or meta.get("tester") or "Unknown").strip() or "Unknown"
        prefix = f"{badge}{temp_text}, {tester}"

        date_text = self._format_test_date(meta.get("date"))
        if not date_text:
            return prefix

        metrics = self.test_list.fontMetrics() if self.test_list else None
        if not metrics or not available_px:
            filler_len = max(3, 48 - len(prefix) - len(date_text))
            filler = "." * filler_len
            return f"{prefix} {filler} {date_text}"

        dot_width = max(1, metrics.horizontalAdvance("."))
        prefix_width = metrics.horizontalAdvance(prefix + " ")
        suffix_width = metrics.horizontalAdvance(" " + date_text)
        filler_width = max(0, available_px - prefix_width - suffix_width)

        if filler_width <= 0:
            filler = "..."
        else:
            dot_count = max(3, filler_width // dot_width)
            filler = "." * int(dot_count)
        return f"{prefix} {filler} {date_text}"

    def _format_test_date(self, date_str: Optional[str]) -> str:
        if not date_str:
            return ""
        normalized = str(date_str).strip()
        if not normalized:
            return ""
        for fmt in ("%m-%d-%Y", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                dt = datetime.datetime.strptime(normalized, fmt)
                return dt.strftime("%d/%m/%Y")
            except ValueError:
                continue
        return normalized.replace("-", "/")

    def _meta_path_for_csv(self, csv_path: str) -> str:
        base, _ext = os.path.splitext(csv_path)
        return f"{base}.meta.json"

    def _load_meta_for_csv(self, csv_path: str) -> Optional[dict]:
        meta_path = self._meta_path_for_csv(csv_path)
        if not os.path.isfile(meta_path):
            return None
        try:
            with open(meta_path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                return data
        except Exception:
            return None
        return None

    def _extract_temperature_value(self, meta: dict) -> Optional[float]:
        for key in ("room_temperature_f", "room_temp_f", "ambient_temp_f", "avg_temp"):
            value = meta.get(key)
            if value is None:
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None
