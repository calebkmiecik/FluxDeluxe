from __future__ import annotations

import time

from PySide6 import QtCore, QtGui, QtWidgets


class DeviceListDelegate(QtWidgets.QStyledItemDelegate):
    """Custom delegate to render green checkmark for active devices."""

    def paint(self, painter: QtGui.QPainter, option: QtWidgets.QStyleOptionViewItem, index: QtCore.QModelIndex) -> None:  # noqa: N802
        # Paint base item first
        super().paint(painter, option, index)

        # Check if device is active (UserRole + 1 should be True/False)
        is_active = index.data(QtCore.Qt.UserRole + 1)
        text = str(index.data(QtCore.Qt.DisplayRole) or "")
        rect = option.rect

        # Only paint checkmark if explicitly True
        if is_active is True:
            painter.save()
            try:
                # Use a larger, more visible checkmark
                check_text = " \u2713"

                painter.setFont(option.font)
                fm = painter.fontMetrics()
                text_width = fm.horizontalAdvance(text)

                # Position checkmark after the text
                x = rect.left() + text_width + 10
                y = rect.top() + (rect.height() + fm.ascent()) // 2 - fm.descent() // 2

                # Bright green color for visibility
                painter.setPen(QtGui.QColor(100, 255, 100))
                painter.setRenderHint(QtGui.QPainter.Antialiasing)

                # Draw the checkmark
                painter.drawText(x, y, check_text)
            finally:
                painter.restore()

        # Temperature + trend (right-aligned, selection-aware colors)
        temp_f = index.data(QtCore.Qt.UserRole + 2)
        if temp_f is not None:
            try:
                is_selected = bool(option.state & QtWidgets.QStyle.StateFlag.State_Selected)
                trend_str = index.data(QtCore.Qt.UserRole + 3)   # "heating" | "cooling" | "stable" | None
                stable_since = index.data(QtCore.Qt.UserRole + 4)  # float timestamp or None

                temp_text = f"{float(temp_f):.1f}\u00b0F"
                fm = painter.fontMetrics()
                baseline_y = rect.top() + (rect.height() + fm.ascent()) // 2 - fm.descent() // 2

                # Build trend prefix: arrow + optional time
                trend_prefix = ""
                if trend_str == "heating":
                    trend_prefix = "\u2191"  # ↑
                    trend_color_normal = QtGui.QColor(220, 60, 60)   # red
                elif trend_str == "cooling":
                    trend_prefix = "\u2193"  # ↓
                    trend_color_normal = QtGui.QColor(60, 140, 255)  # blue
                elif trend_str == "stable":
                    trend_prefix = "\u2192"  # →
                    trend_color_normal = QtGui.QColor(60, 200, 60)   # green
                    if stable_since is not None:
                        elapsed_min = (time.time() - stable_since) / 60.0
                        if elapsed_min >= 60.0:
                            trend_prefix += f" {int(elapsed_min / 15) * 0.25:.2g}h"
                        else:
                            trend_prefix += f" {int(elapsed_min)}m"
                else:
                    trend_color_normal = QtGui.QColor(180, 180, 180)

                # Colors: dark when selected (blue bg), normal otherwise
                dark_color = QtGui.QColor(50, 50, 50)
                temp_color = dark_color if is_selected else QtGui.QColor(180, 180, 180)
                trend_color = dark_color if is_selected else trend_color_normal

                # Layout: [trend_prefix] [6px gap] [temp_text] [8px right margin]
                temp_w = fm.horizontalAdvance(temp_text)
                trend_w = fm.horizontalAdvance(trend_prefix) if trend_prefix else 0
                gap = 6 if trend_prefix else 0
                right_margin = 8

                x_temp = rect.right() - temp_w - right_margin
                x_trend = x_temp - gap - trend_w

                painter.save()

                # Draw trend arrow + time
                if trend_prefix:
                    painter.setPen(trend_color)
                    painter.drawText(x_trend, baseline_y, trend_prefix)

                # Draw temperature
                painter.setPen(temp_color)
                painter.drawText(x_temp, baseline_y, temp_text)

                painter.restore()
            except Exception:
                pass


class DiscreteTestDelegate(QtWidgets.QStyledItemDelegate):
    """Custom delegate to render discrete tests with left label, dotted leader, and right-aligned date."""

    def paint(self, painter: QtGui.QPainter, option: QtWidgets.QStyleOptionViewItem, index: QtCore.QModelIndex) -> None:  # type: ignore[override]
        # Let base class draw background/selection
        QtWidgets.QStyledItemDelegate.paint(self, painter, option, index)
        left = str(index.data(QtCore.Qt.UserRole + 1) or "")
        date = str(index.data(QtCore.Qt.UserRole + 2) or "")
        if not left and not date:
            return
        r = option.rect
        fm = option.fontMetrics
        painter.save()
        painter.setPen(option.palette.color(QtGui.QPalette.Text))
        # Vertical alignment
        baseline_y = r.top() + (r.height() + fm.ascent() - fm.descent()) // 2
        padding = 6
        left_x = r.left() + padding
        # Draw left label
        painter.drawText(left_x, baseline_y, left)
        left_w = fm.horizontalAdvance(left)
        # Draw right date
        date_w = fm.horizontalAdvance(date)
        right_x = r.right() - padding - date_w
        painter.drawText(right_x, baseline_y, date)
        # Draw dotted leader between
        dots_start_x = left_x + left_w + padding
        dots_end_x = right_x - padding
        dot_w = max(1, fm.horizontalAdvance("."))
        if dots_end_x > dots_start_x + dot_w:
            count = int((dots_end_x - dots_start_x) / dot_w)
            dots = "." * max(0, count)
            painter.drawText(dots_start_x, baseline_y, dots)
        painter.restore()
