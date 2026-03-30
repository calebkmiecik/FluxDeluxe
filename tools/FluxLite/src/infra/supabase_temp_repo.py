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
    """CRUD + Storage helpers for the ``temp_test_sessions`` table
    and the ``temp-testing-csvs`` bucket.
    """

    def __init__(self):
        from .supabase_client import get_client

        self._sb = get_client()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def sync_session_from_meta(self, meta_path: str) -> None:
        """Read meta JSON → upsert session → upload trimmed CSV."""
        if self._sb is None:
            return
        try:
            meta_path = os.path.abspath(str(meta_path or ""))
            if not os.path.isfile(meta_path):
                _logger.warning("Supabase sync: meta file not found – %s", meta_path)
                return

            with open(meta_path, "r", encoding="utf-8") as fh:
                meta: dict = json.load(fh) or {}

            device_id = self._device_id_from_meta(meta, meta_path)
            folder = os.path.dirname(meta_path)

            # Upload trimmed CSV if available.
            trimmed_storage = None
            baseline = meta.get("processed_baseline") or {}
            if isinstance(baseline, dict) and baseline.get("trimmed_csv"):
                trimmed_path = os.path.join(folder, baseline["trimmed_csv"])
                trimmed_storage = self.upload_csv_gzipped(trimmed_path, device_id)

            session_id = self.upsert_session(meta, meta_path, trimmed_csv_storage_path=trimmed_storage)
            if session_id:
                _logger.info("Supabase sync complete for session %s", session_id)
        except Exception as exc:
            _logger.warning("Supabase sync_session_from_meta failed: %s", exc)

    # ------------------------------------------------------------------
    # Session upsert
    # ------------------------------------------------------------------

    def upsert_session(
        self,
        meta: dict,
        meta_path: str,
        *,
        trimmed_csv_storage_path: Optional[str] = None,
    ) -> Optional[str]:
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
                "trimmed_csv_storage_path": trimmed_csv_storage_path,
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
    # Remote listing / querying
    # ------------------------------------------------------------------

    def list_all_device_ids(self) -> List[str]:
        """Return distinct device_ids from ``temp_test_sessions`` (excluding soft-deleted)."""
        if self._sb is None:
            return []
        try:
            resp = (
                self._sb.table("temp_test_sessions")
                .select("device_id")
                .is_("deleted_at", "null")
                .execute()
            )
            ids = sorted({str(r.get("device_id") or "") for r in (resp.data or [])})
            return [d for d in ids if d]
        except Exception as exc:
            _logger.warning("list_all_device_ids failed: %s", exc)
            return []

    def list_all_capture_names(self) -> set:
        """Return the set of all active ``capture_name`` values (excluding soft-deleted)."""
        if self._sb is None:
            return set()
        try:
            resp = (
                self._sb.table("temp_test_sessions")
                .select("capture_name")
                .is_("deleted_at", "null")
                .execute()
            )
            return {str(r.get("capture_name") or "") for r in (resp.data or [])} - {""}
        except Exception as exc:
            _logger.warning("list_all_capture_names failed: %s", exc)
            return set()

    def list_deleted_capture_names(self) -> set:
        """Return the set of soft-deleted ``capture_name`` values."""
        if self._sb is None:
            return set()
        try:
            resp = (
                self._sb.table("temp_test_sessions")
                .select("capture_name")
                .not_.is_("deleted_at", "null")
                .execute()
            )
            return {str(r.get("capture_name") or "") for r in (resp.data or [])} - {""}
        except Exception as exc:
            _logger.warning("list_deleted_capture_names failed: %s", exc)
            return set()

    def delete_sessions_by_capture_names(self, capture_names: List[str]) -> int:
        """Delete ``temp_test_sessions`` rows whose ``capture_name`` is in *capture_names*."""
        if self._sb is None or not capture_names:
            return 0
        deleted = 0
        for name in capture_names:
            try:
                self._sb.table("temp_test_sessions").delete().eq(
                    "capture_name", name
                ).execute()
                deleted += 1
            except Exception as exc:
                _logger.warning("delete session %s failed: %s", name, exc)
        return deleted

    def delete_session_fully(self, capture_name: str) -> bool:
        """Soft-delete a session: set ``deleted_at`` and move storage to trash."""
        if self._sb is None or not capture_name:
            return False
        try:
            # Fetch the session to get the storage path.
            resp = (
                self._sb.table("temp_test_sessions")
                .select("trimmed_csv_storage_path")
                .eq("capture_name", capture_name)
                .execute()
            )
            storage_path = ""
            if resp.data:
                storage_path = str(resp.data[0].get("trimmed_csv_storage_path") or "")

            # Move storage file to trash/ prefix if present.
            if storage_path:
                try:
                    trash_path = f"trash/{storage_path}"
                    data = self._sb.storage.from_("temp-testing-csvs").download(storage_path)
                    if data:
                        self._sb.storage.from_("temp-testing-csvs").upload(
                            path=trash_path,
                            file=data,
                            file_options={"content-type": "application/gzip", "upsert": "true"},
                        )
                        self._sb.storage.from_("temp-testing-csvs").remove([storage_path])
                        _logger.info("Moved storage %s → %s", storage_path, trash_path)
                except Exception as exc:
                    _logger.warning("move storage to trash failed for %s: %s", storage_path, exc)

            # Soft-delete: set deleted_at timestamp.
            self._sb.table("temp_test_sessions").update(
                {"deleted_at": "now()"}
            ).eq("capture_name", capture_name).execute()
            _logger.info("Soft-deleted session %s", capture_name)
            return True
        except Exception as exc:
            _logger.warning("delete_session_fully failed for %s: %s", capture_name, exc)
            return False

    def is_deleted(self, capture_name: str) -> bool:
        """Check if a capture_name has been soft-deleted."""
        if self._sb is None or not capture_name:
            return False
        try:
            resp = (
                self._sb.table("temp_test_sessions")
                .select("deleted_at")
                .eq("capture_name", capture_name)
                .not_.is_("deleted_at", "null")
                .execute()
            )
            return bool(resp.data)
        except Exception:
            return False

    def list_sessions_for_device(self, device_id: str) -> List[dict]:
        """Query ``temp_test_sessions`` filtered by *device_id* (excluding soft-deleted)."""
        if self._sb is None or not device_id:
            return []
        try:
            resp = (
                self._sb.table("temp_test_sessions")
                .select("*")
                .eq("device_id", device_id)
                .is_("deleted_at", "null")
                .execute()
            )
            return list(resp.data or [])
        except Exception as exc:
            _logger.warning("list_sessions_for_device failed: %s", exc)
            return []

    # ------------------------------------------------------------------
    # Storage downloads
    # ------------------------------------------------------------------

    def download_csv_gunzipped(self, storage_path: str, local_path: str) -> bool:
        """Download a gzipped file from storage, decompress, and write to *local_path*."""
        if self._sb is None or not storage_path:
            return False
        try:
            data = self._sb.storage.from_("temp-testing-csvs").download(storage_path)
            if not data:
                return False
            decompressed = gzip.decompress(data)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as fh:
                fh.write(decompressed)
            _logger.debug("Downloaded + gunzipped %s → %s", storage_path, local_path)
            return True
        except Exception as exc:
            _logger.warning("download_csv_gunzipped failed for %s: %s", storage_path, exc)
            return False

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
