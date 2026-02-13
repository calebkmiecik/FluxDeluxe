from __future__ import annotations

from typing import Optional

from PySide6 import QtCore, QtWidgets


class PauseSummaryBox(QtWidgets.QGroupBox):
    """Results column for the live testing panel.

    The group box (with its "Results" title) is always visible so it
    reserves its column.  The inner content is hidden until
    ``show_content()`` is called (typically on session pause).
    """

    resume_clicked = QtCore.Signal()
    finish_clicked = QtCore.Signal()

    def __init__(self, parent: Optional[QtWidgets.QWidget] = None) -> None:
        super().__init__("Results", parent)
        outer = QtWidgets.QVBoxLayout(self)

        # Inner container — hidden by default
        self._content = QtWidgets.QWidget()
        self._content.setVisible(False)
        outer.addWidget(self._content)
        outer.addStretch(1)

        layout = QtWidgets.QVBoxLayout(self._content)
        layout.setContentsMargins(0, 0, 0, 0)

        # Overall summary
        self._lbl_overall = QtWidgets.QLabel("0 / 0 cells passed (0%)")
        self._lbl_overall.setStyleSheet("font-weight: bold;")
        layout.addWidget(self._lbl_overall)

        self._lbl_avg_error = QtWidgets.QLabel("Avg Error: -- N")
        layout.addWidget(self._lbl_avg_error)

        # Separator
        sep = QtWidgets.QFrame()
        sep.setFrameShape(QtWidgets.QFrame.HLine)
        sep.setFrameShadow(QtWidgets.QFrame.Sunken)
        layout.addWidget(sep)

        # By-stage section
        lbl_stages = QtWidgets.QLabel("By Stage")
        lbl_stages.setStyleSheet("font-weight: bold;")
        layout.addWidget(lbl_stages)

        # Scrollable area for stage rows
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setMaximumHeight(140)
        scroll_content = QtWidgets.QWidget()
        self._stages_layout = QtWidgets.QVBoxLayout(scroll_content)
        self._stages_layout.setContentsMargins(2, 2, 2, 2)
        self._stages_layout.setSpacing(2)
        self._stages_layout.addStretch(1)
        scroll.setWidget(scroll_content)
        layout.addWidget(scroll)

        # Separator
        sep2 = QtWidgets.QFrame()
        sep2.setFrameShape(QtWidgets.QFrame.HLine)
        sep2.setFrameShadow(QtWidgets.QFrame.Sunken)
        layout.addWidget(sep2)

        # Buttons
        btn_row = QtWidgets.QHBoxLayout()
        self.btn_resume = QtWidgets.QPushButton("Resume")
        self.btn_finish = QtWidgets.QPushButton("Finish")
        btn_row.addWidget(self.btn_resume)
        btn_row.addWidget(self.btn_finish)
        layout.addLayout(btn_row)

        self.btn_resume.clicked.connect(self.resume_clicked.emit)
        self.btn_finish.clicked.connect(self.finish_clicked.emit)

    # ------------------------------------------------------------------
    def show_content(self) -> None:
        self._content.setVisible(True)

    def hide_content(self) -> None:
        self._content.setVisible(False)

    # ------------------------------------------------------------------
    def update_summary(self, summary_data: dict) -> None:
        """Populate the summary from a dict produced by LiveTestController.compute_session_summary()."""
        overall_tested = int(summary_data.get("overall_tested", 0))
        overall_passed = int(summary_data.get("overall_passed", 0))
        overall_avg_error_pct = summary_data.get("overall_avg_error_pct")

        pct = f"{overall_passed * 100 // overall_tested}%" if overall_tested > 0 else "0%"
        self._lbl_overall.setText(f"{overall_passed} / {overall_tested} cells passed ({pct})")

        if overall_avg_error_pct is not None and overall_tested > 0:
            self._lbl_avg_error.setText(f"Avg Error: {overall_avg_error_pct:.1f}%")
        else:
            self._lbl_avg_error.setText("Avg Error: --%")

        # Clear old stage labels (keep trailing stretch)
        while self._stages_layout.count() > 1:
            item = self._stages_layout.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()

        for stage_info in summary_data.get("stages", []):
            name = stage_info.get("name", "?")
            tested = int(stage_info.get("tested", 0))
            passed = int(stage_info.get("passed", 0))
            avg_err_pct = stage_info.get("avg_error_pct")
            err_str = f"{avg_err_pct:.1f}%" if avg_err_pct is not None and tested > 0 else "--"
            s_pct = f"{passed * 100 // tested}%" if tested > 0 else "0%"
            lbl = QtWidgets.QLabel(f"{name}: {passed}/{tested} passed ({s_pct}), avg err {err_str}")
            self._stages_layout.insertWidget(self._stages_layout.count() - 1, lbl)
