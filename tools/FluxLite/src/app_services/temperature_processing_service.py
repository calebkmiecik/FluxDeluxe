from __future__ import annotations

import os
from typing import Callable, Dict, Optional

import numpy as np
import pandas as pd

from .backend_csv_processor import process_csv_via_backend

# Dynamo stage-1 per-axis temperature correction coefficients (1/°F)
_TEMP_COEFS: dict[str, float] = {
    "06": 0.002,
    "07": 0.0025,
    "08": 0.0009,
    "10": 0.002,
    "11": 0.0025,
    "12": 0.0009,
}


class TemperatureProcessingService:
    """
    Orchestrates temperature test processing:
    - derive paths
    - downsample to 50Hz
    - run backend processing off/on
    - update meta
    """

    def __init__(self, *, repo: object, hardware: object | None) -> None:
        self._repo = repo
        self._hardware = hardware

    def run_temperature_processing(
        self,
        *,
        folder: str,
        device_id: str,
        csv_path: str,
        slopes: dict,
        room_temp_f: float = 72.0,
        mode: str = "legacy",
        status_cb: Callable[[dict], None] | None = None,
    ) -> None:
        def emit(payload: dict) -> None:
            if status_cb is None:
                return
            try:
                status_cb(dict(payload or {}))
            except Exception:
                pass

        if not self._hardware:
            emit({"status": "error", "message": "Hardware service unavailable for temperature correction"})
            return

        try:
            paths = self._repo.derive_temperature_paths(csv_path, device_id, mode)

            slopes_name = self._repo.formatted_slope_name(slopes)
            processed_on_name = paths["processed_on_template"].format(slopes=slopes_name)

            # Prefer existing trimmed CSV; only fall back to raw for downsampling.
            has_trimmed = os.path.isfile(paths["trimmed"])
            has_raw = os.path.isfile(csv_path)
            if has_trimmed:
                trimmed_path = paths["trimmed"]
                emit({"status": "running", "message": "Using existing 50Hz CSV...", "progress": 5})
            elif has_raw:
                emit({"status": "running", "message": "Slimming CSV to 50Hz...", "progress": 5})
                trimmed_path = self._repo.downsample_csv_to_50hz(csv_path, paths["trimmed"])
            else:
                emit({"status": "error", "message": f"Neither trimmed nor raw CSV found for {os.path.basename(csv_path)}"})
                return

            emit({"status": "running", "message": "Checking baseline...", "progress": 25})

            processed_off_path = os.path.join(folder, paths["processed_off_name"])
            if os.path.isfile(processed_off_path):
                emit({"status": "running", "message": "Using existing baseline...", "progress": 25})
            else:
                emit({"status": "running", "message": "Processing (temp correction off)...", "progress": 25})
                self._call_backend_process_csv(
                    input_csv_path=trimmed_path,
                    device_id=device_id,
                    output_folder=folder,
                    output_filename=paths["processed_off_name"],
                    use_temperature_correction=False,
                    room_temp_f=room_temp_f,
                    slopes=None,
                    mode="legacy",
                )

            emit({"status": "running", "message": "Processing (temp correction on)...", "progress": 65})

            self._call_backend_process_csv(
                input_csv_path=trimmed_path,
                device_id=device_id,
                output_folder=folder,
                output_filename=processed_on_name,
                use_temperature_correction=True,
                room_temp_f=room_temp_f,
                slopes=slopes,
                mode=mode,
            )

            self._repo.update_meta_with_processed(
                paths["meta"],
                trimmed_path,
                os.path.join(folder, paths["processed_off_name"]),
                os.path.join(folder, processed_on_name),
                slopes,
                mode,
            )

            emit({"status": "completed", "message": "Temperature processing complete", "progress": 100})
        except Exception as e:
            emit({"status": "error", "message": str(e)})

    def ensure_temp_off_processed(
        self,
        *,
        folder: str,
        device_id: str,
        csv_path: str,
        room_temp_f: float = 72.0,
        status_cb: Callable[[dict], None] | None = None,
    ) -> str:
        """
        Ensure the "temp correction OFF" processed CSV exists for a given raw temp test.

        Unlike `run_temperature_processing`, this does NOT produce a "temp correction ON"
        variant. It is intended for building per-device room-temp baseline bias.

        Returns the full path to the processed-off CSV.
        """
        def emit(payload: dict) -> None:
            if status_cb is None:
                return
            try:
                status_cb(dict(payload or {}))
            except Exception:
                pass

        # derive_temperature_paths is pure string manipulation — works even if the raw CSV
        # doesn't exist on disk (e.g. meta-only sessions synced from Supabase).
        paths = self._repo.derive_temperature_paths(csv_path, device_id, mode="legacy")
        processed_off_path = os.path.join(folder, paths["processed_off_name"])

        # Short-circuit: if the processed-off file already exists (e.g. downloaded
        # from Supabase), return immediately — no raw CSV or hardware needed.
        if os.path.isfile(processed_off_path):
            return processed_off_path

        # We need to produce the processed-off file.  Check what inputs are available.
        has_raw = os.path.isfile(csv_path)
        has_trimmed = os.path.isfile(paths["trimmed"])

        if not has_raw and not has_trimmed:
            raise FileNotFoundError(
                f"Neither raw CSV nor trimmed CSV found on disk for {os.path.basename(csv_path)}"
            )
        if not self._hardware:
            raise RuntimeError("Hardware service unavailable for temperature correction")

        if has_trimmed:
            trimmed_path = paths["trimmed"]
        else:
            emit({"status": "running", "message": "Slimming baseline CSV to 50Hz...", "progress": 5})
            trimmed_path = self._repo.downsample_csv_to_50hz(csv_path, paths["trimmed"])

        emit({"status": "running", "message": "Processing baseline (temp correction off)...", "progress": 25})
        self._call_backend_process_csv(
            input_csv_path=trimmed_path,
            device_id=device_id,
            output_folder=folder,
            output_filename=paths["processed_off_name"],
            use_temperature_correction=False,
            room_temp_f=room_temp_f,
            slopes=None,
            mode="legacy",
        )

        # Record baseline output in meta for discoverability in the UI and for future reuse.
        try:
            self._repo.update_meta_with_baseline_only(
                paths["meta"],
                trimmed_csv=trimmed_path,
                processed_off=processed_off_path,
            )
        except Exception:
            # Meta updates are best-effort; baseline processing result is still valid.
            pass

        return processed_off_path

    def _call_backend_process_csv(
        self,
        *,
        input_csv_path: str,
        device_id: str,
        output_folder: str,
        output_filename: str,
        use_temperature_correction: bool,
        room_temp_f: float,
        slopes: Optional[dict] = None,
        mode: str = "legacy",
    ) -> None:
        temperature_coefficients = None
        if slopes:
            temperature_coefficients = {
                "x": float(slopes.get("x", 0.0)),
                "y": float(slopes.get("y", 0.0)),
                "z": float(slopes.get("z", 0.0)),
            }

        process_csv_via_backend(
            input_csv_path=input_csv_path,
            device_id=device_id,
            output_folder=output_folder,
            output_filename=output_filename,
            use_temperature_correction=use_temperature_correction,
            room_temp_f=room_temp_f,
            mode=mode,
            temperature_coefficients=temperature_coefficients,
            sanitize_header=True,
            hardware=self._hardware,
            timeout_s=300,
        )


def revert_baked_temp_correction(
    trimmed_path: str,
    device_id: str,
    room_temp_f: float = 76.0,
    *,
    undo: bool = False,
) -> None:
    """Revert (or re-apply) Dynamo stage-1 temperature correction baked into a trimmed CSV.

    When *undo* is False, recovers true raw sensor values::

        raw = csv_value / (1 - (room - T) * coef)

    When *undo* is True, re-applies the correction (reverses a prior revert)::

        corrected = csv_value * (1 - (room - T) * coef)

    Modifies the file in-place.
    """
    dev_type = str(device_id or "")[:2]
    coef = _TEMP_COEFS.get(dev_type)
    if coef is None:
        raise ValueError(f"No temperature coefficient for device type '{dev_type}'")

    df = pd.read_csv(trimmed_path, dtype={"device_id": str})

    # Discover sensor groups: columns ending in '-t' with matching '-x', '-y', '-z'.
    temp_cols = [c for c in df.columns if c.endswith("-t") and c != "sum-t"]
    if not temp_cols:
        raise ValueError("No per-sensor temperature columns found in CSV")

    for tc in temp_cols:
        prefix = tc[:-2]  # e.g. "front-left-outer"
        xc, yc, zc = f"{prefix}-x", f"{prefix}-y", f"{prefix}-z"
        missing = [c for c in (xc, yc, zc) if c not in df.columns]
        if missing:
            raise ValueError(f"Missing sensor columns for {prefix}: {missing}")

        t = df[tc].to_numpy(dtype=np.float64)
        factor = 1.0 - (room_temp_f - t) * coef

        if undo:
            # Re-apply: raw → corrected
            for ac in (xc, yc, zc):
                df[ac] = df[ac].to_numpy(dtype=np.float64) * factor
        else:
            # Revert: corrected → raw
            for ac in (xc, yc, zc):
                df[ac] = df[ac].to_numpy(dtype=np.float64) / factor

    # Adjust sum columns by the cumulative delta (preserves tare offsets).
    for axis in ("x", "y", "z"):
        sum_col = f"sum-{axis}"
        if sum_col not in df.columns:
            continue
        axis_cols = [c for c in df.columns if c.endswith(f"-{axis}") and c != sum_col]
        if not axis_cols:
            continue
        # delta = sum of (new_value - old_value) across all sensors for this axis
        delta = np.zeros(len(df), dtype=np.float64)
        for tc in temp_cols:
            prefix = tc[:-2]
            ac = f"{prefix}-{axis}"
            if ac not in df.columns:
                continue
            t = df[tc].to_numpy(dtype=np.float64)
            factor = 1.0 - (room_temp_f - t) * coef
            old_vals = df[ac].to_numpy(dtype=np.float64)
            if undo:
                # We already multiplied by factor above; original was old / factor
                delta += old_vals - (old_vals / factor)
            else:
                # We already divided by factor above; original was old * factor
                delta += old_vals - (old_vals * factor)
        df[sum_col] = df[sum_col].to_numpy(dtype=np.float64) + delta

    df.to_csv(trimmed_path, index=False)
