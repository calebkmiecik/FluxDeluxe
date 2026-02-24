from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from ..project_paths import data_dir
from .hardware import HardwareService


@dataclass(frozen=True)
class CaptureContext:
    group_id: str
    capture_name: str
    csv_dir: str


class TemperatureLiveCaptureManager:
    """
    Temperature live-testing capture orchestration.

    Mirrors the historical behavior from `references/old_main_window.py`:
    - Pre-configure backend Dynamo capture settings (captureDetail=allTemp, etc.)
    - Emit a 'simple' capture start with tags ["raw","full-detail"]
    - Use temp-raw-* naming and sensible group-id resolution
    """

    def __init__(self, hardware: HardwareService) -> None:
        self._hw = hardware

    def start(
        self,
        *,
        device_id: str,
        save_dir: str,
        group_id_fallback: str = "",
    ) -> Optional[CaptureContext]:
        dev_id = str(device_id or "").strip()
        if not dev_id:
            return None

        resolved_dir = self._resolve_dir(device_id=dev_id, save_dir=save_dir)
        try:
            os.makedirs(resolved_dir, exist_ok=True)
        except Exception:
            pass

        # Configure backend capture settings prior to session (legacy behavior).
        try:
            self._hw.update_dynamo_config("autoSaveCsvs", True)
            self._hw.update_dynamo_config("csvSaveDirectory", str(resolved_dir))
            self._hw.update_dynamo_config("captureDetail", "allTemp")
            self._hw.update_dynamo_config("captureDetailRatio", 1)
            self._hw.update_dynamo_config("normalizeData", False)
        except Exception:
            pass

        # Resolve group id: backend mapping -> UI fallback -> device id (temperature mode default)
        group_id = ""
        try:
            group_id = str(self._hw.resolve_group_id_for_device(dev_id) or "").strip()
        except Exception:
            group_id = ""
        if not group_id:
            group_id = str(group_id_fallback or "").strip()
        if not group_id:
            group_id = dev_id

        # Build captureName: temp-raw-<device>-<timestamp>
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        dev_part = self._sanitize(dev_id)
        capture_name = f"temp-raw-{dev_part}-{ts}" if dev_part else f"temp-raw-{ts}"

        payload = {
            "capture_name": capture_name,
            "capture_configuration": "simple",
            "group_id": group_id,
            "athlete_id": "",
            "tags": ["raw", "full-detail"],
        }
        try:
            self._hw.start_capture(payload)
        except Exception:
            pass

        return CaptureContext(group_id=group_id, capture_name=capture_name, csv_dir=str(resolved_dir))

    def stop(self, *, group_id: str) -> None:
        gid = str(group_id or "").strip()
        if not gid:
            return
        try:
            self._hw.stop_capture({"group_id": gid})
        except Exception:
            pass

    def _resolve_dir(self, *, device_id: str, save_dir: str) -> str:
        """
        Resolve the capture directory.

        When the save_dir is empty OR falls under the ``temp_testing/`` base,
        always resolve to ``temp_testing/<device_id>/``.  Only honour a fully
        custom path if it is outside ``temp_testing/`` entirely (the user
        explicitly chose an external location).
        """
        base_temp = data_dir("temp_testing")
        dev_norm = self._sanitize(device_id)

        resolved_dir_in = str(save_dir or "").strip()

        # Default: temp_testing/<device_id>
        if not resolved_dir_in or not dev_norm:
            return os.path.join(base_temp, dev_norm) if dev_norm else base_temp

        # If the user's save_dir is anywhere under temp_testing/, always
        # force the correct device subfolder to prevent misplaced files.
        try:
            norm_in = os.path.normpath(resolved_dir_in)
            norm_base = os.path.normpath(base_temp)
            if norm_in == norm_base or norm_in.startswith(norm_base + os.sep):
                return os.path.join(base_temp, dev_norm)
        except Exception:
            pass

        # Fully external directory — honour user's choice as-is.
        return resolved_dir_in

    @staticmethod
    def _sanitize(s: str) -> str:
        # Allow '.' in capture names/dirs to preserve real device id format ("07.00000051").
        try:
            return "".join(ch for ch in str(s or "") if (ch.isalnum() or ch in (".", "-", "_")))
        except Exception:
            return str(s or "")

