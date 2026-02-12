"""Repository for syncing temperature-testing data to Supabase.

All public methods are designed to be called from a background thread.
Every call is wrapped in try/except so failures never propagate to the
caller — the local workflow continues unaffected.
"""
from __future__ import annotations

import gzip
import io
import json
import logging
import os
import time
from typing import Dict, List, Optional

_logger = logging.getLogger(__name__)


class SupabaseTempRepository:
    """CRUD + Storage helpers for the ``temp_test_sessions`` /
    ``temp_test_processing_runs`` tables and the ``temp-testing-csvs`` bucket.
    """

    def __init__(self):
        from .supabase_client import get_client

        self._sb = get_client()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def sync_session_from_meta(self, meta_path: str) -> None:
        """Orchestrator: read meta JSON → upsert session + runs → upload CSVs."""
        if self._sb is None:
            return
        try:
            meta_path = os.path.abspath(str(meta_path or ""))
            if not os.path.isfile(meta_path):
                _logger.warning("Supabase sync: meta file not found – %s", meta_path)
                return

            with open(meta_path, "r", encoding="utf-8") as fh:
                meta: dict = json.load(fh) or {}

            session_id = self.upsert_session(meta, meta_path)
            if not session_id:
                return

            device_id = self._device_id_from_meta(meta, meta_path)
            folder = os.path.dirname(meta_path)

            # --- baseline ---
            baseline = meta.get("processed_baseline") or {}
            if isinstance(baseline, dict) and baseline.get("processed_off"):
                trimmed_path = os.path.join(folder, baseline["trimmed_csv"]) if baseline.get("trimmed_csv") else None
                off_path = os.path.join(folder, baseline["processed_off"])

                trimmed_storage = self.upload_csv_gzipped(trimmed_path, device_id) if trimmed_path else None
                off_storage = self.upload_csv_gzipped(off_path, device_id)

                self.upsert_processing_run(session_id, {
                    "mode": "baseline",
                    "slope_x": 0.0,
                    "slope_y": 0.0,
                    "slope_z": 0.0,
                    "is_baseline": True,
                    "trimmed_csv_storage_path": trimmed_storage,
                    "processed_csv_storage_path": off_storage,
                    "processed_at_ms": baseline.get("updated_at_ms"),
                })

            _logger.info("Supabase sync complete for session %s", session_id)
        except Exception as exc:
            _logger.warning("Supabase sync_session_from_meta failed: %s", exc)

    # ------------------------------------------------------------------
    # Session upsert
    # ------------------------------------------------------------------

    def upsert_session(self, meta: dict, meta_path: str) -> Optional[str]:
        """Upsert a ``temp_test_sessions`` row.  Returns the session UUID."""
        if self._sb is None:
            return None
        try:
            capture_name = self._capture_name_from_meta_path(meta_path)
            device_id = self._device_id_from_meta(meta, meta_path)

            row = {
                "device_id": device_id,
                "capture_name": capture_name,
                "model_id": meta.get("model_id") or meta.get("modelId"),
                "tester_name": meta.get("tester_name") or meta.get("testerName"),
                "body_weight_n": _safe_float(meta.get("body_weight_n") or meta.get("bodyWeightN")),
                "avg_temp": _safe_float(meta.get("avg_temp")),
                "session_type": "temperature_test",
                "short_label": meta.get("short_label") or meta.get("shortLabel"),
                "date": meta.get("date"),
                "started_at_ms": _safe_int(meta.get("started_at_ms") or meta.get("startedAtMs")),
                "version": 1,
                "updated_at": "now()",
            }
            # Remove None values so Supabase uses column defaults
            row = {k: v for k, v in row.items() if v is not None}

            resp = (
                self._sb.table("temp_test_sessions")
                .upsert(row, on_conflict="capture_name")
                .execute()
            )
            data = (resp.data or [{}])[0] if resp.data else {}
            session_id = data.get("id")
            if session_id:
                _logger.debug("Upserted session %s (capture=%s)", session_id, capture_name)
            return session_id
        except Exception as exc:
            _logger.warning("upsert_session failed: %s", exc)
            return None

    # ------------------------------------------------------------------
    # Processing-run upsert
    # ------------------------------------------------------------------

    def upsert_processing_run(self, session_id: str, run_data: dict) -> Optional[str]:
        if self._sb is None or not session_id:
            return None
        try:
            row = {
                "session_id": session_id,
                "mode": run_data.get("mode", "legacy"),
                "slope_x": float(run_data.get("slope_x", 0.0)),
                "slope_y": float(run_data.get("slope_y", 0.0)),
                "slope_z": float(run_data.get("slope_z", 0.0)),
                "is_baseline": bool(run_data.get("is_baseline", False)),
                "trimmed_csv_storage_path": run_data.get("trimmed_csv_storage_path"),
                "processed_csv_storage_path": run_data.get("processed_csv_storage_path"),
                "processed_at_ms": _safe_int(run_data.get("processed_at_ms")),
            }
            row = {k: v for k, v in row.items() if v is not None}

            resp = (
                self._sb.table("temp_test_processing_runs")
                .upsert(row, on_conflict="session_id,mode,slope_x,slope_y,slope_z")
                .execute()
            )
            data = (resp.data or [{}])[0] if resp.data else {}
            return data.get("id")
        except Exception as exc:
            _logger.warning("upsert_processing_run failed: %s", exc)
            return None

    # ------------------------------------------------------------------
    # Storage upload (gzipped in-memory)
    # ------------------------------------------------------------------

    def upload_csv_gzipped(self, local_path: Optional[str], device_id: str) -> Optional[str]:
        """Gzip *local_path* in-memory and upload to the ``temp-testing-csvs`` bucket.

        Returns the storage path on success, ``None`` otherwise.
        """
        if self._sb is None:
            return None
        if not local_path or not os.path.isfile(local_path):
            return None
        try:
            with open(local_path, "rb") as fh:
                raw = fh.read()

            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as gz:
                gz.write(raw)
            compressed = buf.getvalue()

            filename = os.path.basename(local_path) + ".gz"
            storage_path = f"{device_id}/{filename}"

            self._sb.storage.from_("temp-testing-csvs").upload(
                path=storage_path,
                file=compressed,
                file_options={
                    "content-type": "application/gzip",
                    "upsert": "true",
                },
            )
            _logger.debug("Uploaded %s (%d KB gzipped)", storage_path, len(compressed) // 1024)
            return storage_path
        except Exception as exc:
            _logger.warning("upload_csv_gzipped failed for %s: %s", local_path, exc)
            return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _capture_name_from_meta_path(meta_path: str) -> str:
        """Derive a unique capture name from the meta filename.

        Example: ``temp-raw-DEVICE-20250101-120000.meta.json`` → ``temp-raw-DEVICE-20250101-120000``
        """
        name = os.path.basename(meta_path)
        if name.endswith(".meta.json"):
            name = name[: -len(".meta.json")]
        return name

    @staticmethod
    def _device_id_from_meta(meta: dict, meta_path: str) -> str:
        """Best-effort device-id extraction: meta field first, then parent folder name."""
        did = str((meta or {}).get("device_id") or "").strip()
        if did:
            return did
        return os.path.basename(os.path.dirname(meta_path))


# ------------------------------------------------------------------
# Module-level tiny helpers
# ------------------------------------------------------------------

def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None
