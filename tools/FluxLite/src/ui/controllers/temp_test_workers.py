from __future__ import annotations

import os
from typing import Dict, Optional, List, Tuple

from PySide6 import QtCore

from ...app_services.testing import TestingService
from ...app_services.temperature_test_import_service import import_temperature_raw_tests


class ProcessingWorker(QtCore.QThread):
    """Worker thread for running temperature processing in the background."""

    def __init__(
        self,
        service: TestingService,
        folder: str,
        device_id: str,
        csv_path: str,
        slopes: dict,
        room_temp_f: float,
        mode: str = "scalar",
    ):
        super().__init__()
        self.service = service
        self.folder = folder
        self.device_id = device_id
        self.csv_path = csv_path
        self.slopes = slopes
        self.room_temp_f = float(room_temp_f)
        self.mode = mode

    def run(self):
        self.service.run_temperature_processing(self.folder, self.device_id, self.csv_path, self.slopes, self.room_temp_f, self.mode)


class TemperatureAnalysisWorker(QtCore.QThread):
    """Background worker for processed run analysis."""

    result_ready = QtCore.Signal(dict)
    error = QtCore.Signal(str)

    def __init__(
        self,
        service: TestingService,
        baseline_csv: str,
        selected_csv: str,
        meta: Dict[str, object],
        baseline_data: Optional[Dict[str, object]] = None,
    ):
        super().__init__()
        self.service = service
        self.baseline_csv = baseline_csv
        self.selected_csv = selected_csv
        self.meta = dict(meta or {})
        self.baseline_data = baseline_data

    def run(self) -> None:
        try:
            payload = self.service.analyze_temperature_processed_runs(
                self.baseline_csv,
                self.selected_csv,
                self.meta,
                baseline_data=self.baseline_data,
            )
            self.result_ready.emit(payload)
        except Exception as exc:
            self.error.emit(str(exc))


class BiasComputeWorker(QtCore.QThread):
    """Background worker for per-device room-temp baseline bias computation."""

    result_ready = QtCore.Signal(dict)

    def __init__(self, service: TestingService, device_id: str):
        super().__init__()
        self.service = service
        self.device_id = str(device_id or "").strip()

    def run(self) -> None:
        try:
            res = self.service.compute_temperature_bias_for_device(self.device_id)
            self.result_ready.emit(dict(res or {}))
        except Exception as exc:
            self.result_ready.emit({"ok": False, "message": str(exc), "errors": [str(exc)]})


class PlateTypeRollupWorker(QtCore.QThread):
    """Background worker for batch rollup across a plate type."""

    result_ready = QtCore.Signal(dict)

    def __init__(self, service: TestingService, plate_type: str, coefs: dict, mode: str):
        super().__init__()
        self.service = service
        self.plate_type = str(plate_type or "").strip()
        self.coefs = dict(coefs or {})
        self.mode = str(mode or "legacy")

    def run(self) -> None:
        try:
            res = self.service.run_temperature_coefs_across_plate_type(
                plate_type=self.plate_type,
                coefs=self.coefs,
                mode=self.mode,
            )
            self.result_ready.emit(dict(res or {}))
        except Exception as exc:
            self.result_ready.emit({"ok": False, "message": str(exc), "errors": [str(exc)]})


class PlateTypeAutoSearchWorker(QtCore.QThread):
    """Background worker that performs coefficient auto-search for a plate type."""

    result_ready = QtCore.Signal(dict)
    status_ready = QtCore.Signal(dict)

    def __init__(self, service: TestingService, plate_type: str, mode: str, search_mode: str):
        super().__init__()
        self.service = service
        self.plate_type = str(plate_type or "").strip()
        self.mode = str(mode or "scalar")
        self.search_mode = str(search_mode or "unified").strip().lower()

    @staticmethod
    def _quantize(v: float, step: float) -> float:
        if step <= 0:
            return float(v)
        return round(float(v) / float(step)) * float(step)

    def _eval(self, coef: float, *, cache: dict) -> tuple[float, Optional[float], Optional[dict]]:
        c = float(coef)
        c = max(0.0, min(0.01, c))
        c = self._quantize(c, 0.0001)  # keep candidates stable/deduped in the search
        key = f"{c:.6f}"
        if key in cache:
            ms = cache[key]
            return c, (float(ms) if ms is not None else None), None

        coefs = {"x": c, "y": c, "z": c}
        self.status_ready.emit({"status": "running", "message": f"Auto search: evaluating coef {c:.4f}…"})

        # Ensure rollup entries exist for this candidate.
        self.service.run_temperature_coefs_across_plate_type(plate_type=self.plate_type, coefs=coefs, mode=self.mode)

        agg = self.service.aggregate_temperature_coefs_for_plate_type(self.plate_type, coefs=coefs, mode=self.mode)
        ms = None
        if isinstance(agg, dict):
            try:
                ms = float(agg.get("mean_signed"))
            except Exception:
                ms = None
        cache[key] = ms
        return c, ms, agg

    @staticmethod
    def _sign(v: float) -> int:
        if v > 0:
            return 1
        if v < 0:
            return -1
        return 0

    def _seed_cache_from_existing(self) -> List[dict]:
        """
        Pull pre-run unified candidates from the existing rollup, and seed cache so we don't
        re-run those coefs unless needed.
        """
        existing = self.service.list_existing_unified_temperature_coef_candidates_for_plate_type(
            self.plate_type, mode=self.mode, min_coef=0.0, max_coef=0.01
        )
        rows: List[dict] = []
        for r in existing or []:
            try:
                c = float(r.get("coef"))
                ms = float(r.get("mean_signed"))
            except Exception:
                continue
            c = max(0.0, min(0.01, self._quantize(c, 0.0001)))
            rows.append({"coef": c, "mean_signed": ms, "coverage": str(r.get("coverage") or "")})
        rows.sort(key=lambda rr: float(rr.get("coef") or 0.0))
        return rows

    @staticmethod
    def _narrowest_sign_flip_bracket(rows: List[dict]) -> Optional[Tuple[float, float, float, float]]:
        """
        Find the narrowest adjacent bracket (by coef) where mean_signed changes sign.
        Returns (low_c, high_c, low_ms, high_ms) or None.
        """
        best = None
        best_w = None
        for i in range(len(rows or []) - 1):
            a = rows[i] or {}
            b = rows[i + 1] or {}
            try:
                ca = float(a.get("coef"))
                cb = float(b.get("coef"))
                ma = float(a.get("mean_signed"))
                mb = float(b.get("mean_signed"))
            except Exception:
                continue
            if ca == cb:
                continue
            sa = 1 if ma > 0 else (-1 if ma < 0 else 0)
            sb = 1 if mb > 0 else (-1 if mb < 0 else 0)
            if sa == 0 or sb == 0:
                # exact zero exists; no need to bracket (caller will handle as best)
                continue
            if sa == sb:
                continue
            low_c, high_c = (ca, cb) if ca < cb else (cb, ca)
            low_ms, high_ms = (ma, mb) if ca < cb else (mb, ma)
            w = high_c - low_c
            if best_w is None or w < best_w:
                best_w = w
                best = (low_c, high_c, low_ms, high_ms)
        return best

    def run(self) -> None:
        if self.search_mode not in ("unified",):
            self.result_ready.emit({"ok": False, "message": f"Unsupported auto search mode: {self.search_mode}", "best": {}})
            return

        # Search parameters (per spec)
        min_c = 0.0
        max_c = 0.01
        coarse_step = 0.001
        refine_step = 0.0001
        start_c = 0.001

        cache: dict = {}
        best = {"coef": None, "mean_signed": None, "abs_mean_signed": None, "coverage": None}

        def _maybe_best(c: float, ms: Optional[float], agg: Optional[dict]) -> None:
            if ms is None:
                return
            abs_ms = abs(float(ms))
            if best["abs_mean_signed"] is None or abs_ms < float(best["abs_mean_signed"]):
                best["coef"] = float(c)
                best["mean_signed"] = float(ms)
                best["abs_mean_signed"] = abs_ms
                if isinstance(agg, dict):
                    best["coverage"] = str(agg.get("coverage") or "")

        # 1) Take stock of pre-run candidates and seed cache/best.
        pre = self._seed_cache_from_existing()
        explored = set()
        for r in pre:
            try:
                c = float(r.get("coef"))
                ms = float(r.get("mean_signed"))
            except Exception:
                continue
            explored.add(c)
            cache[f"{c:.6f}"] = ms
            _maybe_best(c, ms, dict(r))

        # If any pre-run candidate hit exactly 0.0, we're done.
        if best["mean_signed"] is not None and float(best["mean_signed"]) == 0.0:
            self.result_ready.emit({"ok": True, "message": f"Auto search complete: coef {float(best['coef']):.4f} hit 0.00% mean signed.", "best": best})
            return

        # 2) If we already have a sign-flip bracket, pick the narrowest one and fill missing 0.0001-grid points inside it.
        bracket = self._narrowest_sign_flip_bracket(pre)
        if bracket is not None:
            low_c, high_c, low_ms, high_ms = bracket
            self.status_ready.emit({"status": "running", "message": f"Auto search: using pre-run bracket [{low_c:.4f}, {high_c:.4f}] and filling missing 0.0001 steps…"})

            # Determine all 0.0001-grid points inside the bracket.
            lo = self._quantize(low_c, refine_step)
            hi = self._quantize(high_c, refine_step)
            if hi < lo:
                lo, hi = hi, lo

            # Build missing points list.
            pts = []
            n_steps = int(round((hi - lo) / refine_step))
            for k in range(n_steps + 1):
                c = self._quantize(lo + k * refine_step, refine_step)
                if c not in explored:
                    pts.append(c)

            # Evaluate missing points in "closest-to-mid" order, shrinking bracket when possible.
            def _mid() -> float:
                return self._quantize((low_c + high_c) / 2.0, refine_step)

            pts.sort(key=lambda c: abs(c - _mid()))
            for c in pts:
                # If already adjacent, stop.
                if (high_c - low_c) <= refine_step:
                    break
                cm, msm, aggm = self._eval(c, cache=cache)
                explored.add(cm)
                _maybe_best(cm, msm, aggm)
                if msm is None:
                    continue
                msmf = float(msm)
                if msmf == 0.0:
                    break
                # Update bracket if this point helps narrow it (keep sign flip).
                if (low_ms > 0 and msmf > 0) or (low_ms < 0 and msmf < 0):
                    low_c, low_ms = cm, msmf
                else:
                    high_c, high_ms = cm, msmf

            self.result_ready.emit(
                {
                    "ok": True,
                    "message": f"Auto search complete (pre-run bracket): best coef {float(best['coef']):.4f} (mean signed {float(best['mean_signed']):+.2f}%).",
                    "best": best,
                }
            )
            return

        # 3) No pre-run bracket found → fall back to original bracket-then-bisection search.
        c0, ms0, agg0 = self._eval(start_c, cache=cache)
        explored.add(c0)
        _maybe_best(c0, ms0, agg0)
        if ms0 is None:
            self.result_ready.emit({"ok": False, "message": "Auto search failed: no eligible runs to score at start coef.", "best": best})
            return
        if float(ms0) == 0.0:
            self.result_ready.emit({"ok": True, "message": f"Auto search complete: coef {c0:.4f} hit 0.00% mean signed.", "best": best})
            return

        direction = 1.0 if float(ms0) > 0.0 else -1.0
        prev_c, prev_ms = c0, float(ms0)
        bracket = None  # (low_c, high_c, low_ms, high_ms)

        # Bracket by stepping until sign flip or bounds.
        while True:
            next_c = prev_c + direction * coarse_step
            if next_c < min_c or next_c > max_c:
                break
            c1, ms1, agg1 = self._eval(next_c, cache=cache)
            explored.add(c1)
            _maybe_best(c1, ms1, agg1)
            if ms1 is None:
                prev_c, prev_ms = c1, prev_ms
                continue
            ms1f = float(ms1)
            if ms1f == 0.0:
                self.result_ready.emit({"ok": True, "message": f"Auto search complete: coef {c1:.4f} hit 0.00% mean signed.", "best": best})
                return
            if (prev_ms > 0 and ms1f < 0) or (prev_ms < 0 and ms1f > 0):
                low_c, high_c = (prev_c, c1) if prev_c < c1 else (c1, prev_c)
                low_ms, high_ms = (prev_ms, ms1f) if prev_c < c1 else (ms1f, prev_ms)
                bracket = (low_c, high_c, low_ms, high_ms)
                break
            prev_c, prev_ms = c1, ms1f

        # If no bracket, return best seen within bounds.
        if bracket is None:
            if best["coef"] is None:
                self.result_ready.emit({"ok": False, "message": "Auto search complete: no scored candidates.", "best": best})
            else:
                self.result_ready.emit(
                    {
                        "ok": True,
                        "message": f"Auto search complete (no sign flip in range): best coef {float(best['coef']):.4f} (mean signed {float(best['mean_signed']):+.2f}%).",
                        "best": best,
                    }
                )
            return

        low_c, high_c, low_ms, high_ms = bracket
        self.status_ready.emit({"status": "running", "message": f"Auto search: bracket found [{low_c:.4f}, {high_c:.4f}] (sign flip). Refining…"})

        # Bisection refinement
        for _ in range(60):
            if (high_c - low_c) <= refine_step:
                break
            mid = self._quantize((low_c + high_c) / 2.0, refine_step)
            if mid == low_c or mid == high_c:
                break
            # If midpoint was already explored, choose nearest unexplored grid point to mid inside the bracket.
            if mid in explored:
                # Scan outward by 0.0001 for an unexplored point.
                found = None
                step_n = int(round((high_c - low_c) / refine_step))
                for j in range(1, step_n + 1):
                    lo_try = self._quantize(mid - j * refine_step, refine_step)
                    hi_try = self._quantize(mid + j * refine_step, refine_step)
                    if lo_try > low_c and lo_try < high_c and lo_try not in explored:
                        found = lo_try
                        break
                    if hi_try > low_c and hi_try < high_c and hi_try not in explored:
                        found = hi_try
                        break
                if found is None:
                    break
                mid = found

            cm, msm, aggm = self._eval(mid, cache=cache)
            explored.add(cm)
            _maybe_best(cm, msm, aggm)
            if msm is None:
                break
            msmf = float(msm)
            if msmf == 0.0:
                break
            # Choose the half-interval that contains the sign flip.
            if (low_ms > 0 and msmf > 0) or (low_ms < 0 and msmf < 0):
                low_c, low_ms = cm, msmf
            else:
                high_c, high_ms = cm, msmf

        self.result_ready.emit(
            {
                "ok": True,
                "message": f"Auto search complete: best coef {float(best['coef']):.4f} (mean signed {float(best['mean_signed']):+.2f}%).",
                "best": best,
            }
        )


class TemperatureImportWorker(QtCore.QThread):
    """Background worker to import raw temperature tests (copy CSV+meta into temp_testing/<device_id>/)."""

    result_ready = QtCore.Signal(dict)

    def __init__(self, file_paths: List[str]):
        super().__init__()
        self.file_paths = list(file_paths or [])

    def run(self) -> None:
        try:
            res = import_temperature_raw_tests(self.file_paths)
        except Exception as exc:
            res = {"ok": False, "imported": 0, "skipped": 0, "errors": [str(exc)], "affected_devices": [], "affected_plate_types": [], "imported_by_device": {}}
        self.result_ready.emit(dict(res or {}))


class TemperatureAutoUpdateWorker(QtCore.QThread):
    """
    Background worker that performs the post-import auto-update flow:
      - Reset rollups for each affected plate type
      - Run unified auto-search for each affected plate type (which recomputes bias caches internally)
    """

    status_ready = QtCore.Signal(dict)
    result_ready = QtCore.Signal(dict)

    def __init__(self, service: TestingService, plate_types: List[str]):
        super().__init__()
        self.service = service
        self.plate_types = [str(p or "").strip() for p in (plate_types or []) if str(p or "").strip()]

    def run(self) -> None:
        pts = sorted(set(self.plate_types))
        if not pts:
            self.result_ready.emit({"ok": False, "message": "No affected plate types to update.", "results": {}, "errors": ["No plate types"]})
            return

        errors: List[str] = []
        results: Dict[str, dict] = {}

        for pt in pts:
            try:
                self.status_ready.emit({"status": "running", "message": f"Auto-update: resetting rollup for plate {pt}…"})
                self.service.reset_temperature_coef_rollup(pt, backup=True)
            except Exception as exc:
                errors.append(f"{pt}: reset rollup failed: {exc}")

            # Run unified auto-search; this will recompute bias caches for each device in the plate type
            # (TemperatureCoefRollupService always calls compute_and_store_bias_for_device).
            self.status_ready.emit({"status": "running", "message": f"Auto-update: running unified auto search for plate {pt}…"})
            try:
                w = PlateTypeAutoSearchWorker(self.service, pt, "scalar", "unified")
                w.status_ready.connect(self.status_ready.emit)
                holder: List[dict] = []
                w.result_ready.connect(lambda p: holder.append(dict(p or {})))
                # Run synchronously within this worker thread.
                w.run()
                results[pt] = holder[-1] if holder else {"ok": False, "message": "Auto search produced no result"}
            except Exception as exc:
                errors.append(f"{pt}: auto search failed: {exc}")
                results[pt] = {"ok": False, "message": str(exc)}

        ok = all(bool((results.get(pt) or {}).get("ok")) for pt in pts) and not errors
        msg = "Auto-update complete" if ok else "Auto-update complete (with errors)"
        self.result_ready.emit({"ok": ok, "message": msg, "results": results, "errors": errors})


class PlateTypeDistinctCoefsWorker(QtCore.QThread):
    """Runs a small distinct-coefs neighborhood experiment for a plate type.

    Seed: best-known unified coef (x=y=z) for the plate type (by mean abs if available).
    Candidates: for step sizes [0.001, 0.0005, 0.0001], evaluate +/- step on each axis (18 candidates).
    Exports: summary + per-test CSVs for offline analysis.
    """

    result_ready = QtCore.Signal(dict)
    status_ready = QtCore.Signal(dict)

    def __init__(self, service: TestingService, plate_type: str, mode: str = "scalar"):
        super().__init__()
        self.service = service
        self.plate_type = str(plate_type or "").strip()
        self.mode = str(mode or "scalar").strip().lower()

    @staticmethod
    def _quantize(v: float, step: float = 0.0001) -> float:
        if step <= 0:
            return float(v)
        return round(float(v) / float(step)) * float(step)

    @staticmethod
    def _coef_key(mode: str, x: float, y: float, z: float) -> str:
        m = str(mode or "scalar").strip().lower()
        return f"{m}:x={float(x):.6f},y={float(y):.6f},z={float(z):.6f}"

    def _pick_seed_unified(self) -> Optional[dict]:
        """Pick best unified coef candidate (x=y=z) from existing rollup data.

        Prefer lowest score_mean_abs; fallback to smallest abs(mean_signed).
        """
        rows = self.service.list_existing_unified_temperature_coef_candidates_for_plate_type(
            self.plate_type, mode=self.mode, min_coef=0.0, max_coef=0.01
        )
        best = None
        best_score = None
        best_signed = None
        for r in rows or []:
            try:
                c = float(r.get("coef"))
            except Exception:
                continue
            try:
                score_abs = float(r.get("score_mean_abs")) if r.get("score_mean_abs") is not None else None
            except Exception:
                score_abs = None
            try:
                ms = float(r.get("mean_signed"))
            except Exception:
                ms = None

            if score_abs is not None:
                if best_score is None or score_abs < best_score:
                    best_score = score_abs
                    best = {"coef": c, "score_mean_abs": score_abs, "mean_signed": ms}
                continue

            if ms is not None and best_score is None:
                ab = abs(ms)
                if best_signed is None or ab < best_signed:
                    best_signed = ab
                    best = {"coef": c, "score_mean_abs": None, "mean_signed": ms}
        return best

    def run(self) -> None:
        pt = self.plate_type
        if not pt:
            self.result_ready.emit({"ok": False, "message": "Missing plate type", "errors": ["Missing plate type"]})
            return

        seed_info = self._pick_seed_unified()
        if seed_info is None:
            self.status_ready.emit({"status": "running", "message": "Distinct coefs: no unified seed found; running unified search to create one..."})
            try:
                w = PlateTypeAutoSearchWorker(self.service, pt, self.mode, "unified")
                w.status_ready.connect(self.status_ready.emit)
                w.run()
            except Exception:
                pass
            seed_info = self._pick_seed_unified()

        if seed_info is None:
            self.result_ready.emit({"ok": False, "message": "Distinct coefs: no unified seed available.", "errors": ["No unified seed"]})
            return

        seed_c = float(seed_info.get("coef") or 0.0)
        seed_c = max(0.0, min(0.01, self._quantize(seed_c)))
        seed = {"x": seed_c, "y": seed_c, "z": seed_c, "coef_key": self._coef_key(self.mode, seed_c, seed_c, seed_c)}

        steps = [0.001, 0.0005, 0.0001]
        axes = ["x", "y", "z"]
        candidates: List[dict] = []
        seen = set()

        for s in steps:
            for ax in axes:
                for direction in (+1.0, -1.0):
                    x, y, z = seed_c, seed_c, seed_c
                    if ax == "x":
                        x = self._quantize(max(0.0, min(0.01, x + direction * s)))
                    elif ax == "y":
                        y = self._quantize(max(0.0, min(0.01, y + direction * s)))
                    else:
                        z = self._quantize(max(0.0, min(0.01, z + direction * s)))
                    key = (x, y, z)
                    if key in seen:
                        continue
                    seen.add(key)
                    candidates.append(
                        {
                            "step": float(s),
                            "axis": ax,
                            "direction": "+" if direction > 0 else "-",
                            "x": float(x),
                            "y": float(y),
                            "z": float(z),
                            "coef_key": self._coef_key(self.mode, x, y, z),
                        }
                    )

        for i, c in enumerate(candidates):
            msg = (
                f"Distinct coefs: {i+1}/{len(candidates)} (step {float(c.get('step') or 0.0):.4f}, "
                f"{c.get('axis')}{c.get('direction')}): x={float(c.get('x') or 0.0):.4f},"
                f"y={float(c.get('y') or 0.0):.4f},z={float(c.get('z') or 0.0):.4f}"
            )
            self.status_ready.emit({"status": "running", "message": msg})
            try:
                self.service.run_temperature_coefs_across_plate_type(
                    plate_type=pt,
                    coefs={"x": float(c["x"]), "y": float(c["y"]), "z": float(c["z"])} ,
                    mode=self.mode,
                )
            except Exception as exc:
                self.result_ready.emit({"ok": False, "message": f"Distinct coefs failed: {exc}", "errors": [str(exc)]})
                return

        self.status_ready.emit({"status": "running", "message": "Distinct coefs: exporting CSV report..."})
        try:
            exporter = getattr(self.service, "export_distinct_temperature_experiment_report", None)
            if callable(exporter):
                rep = exporter(pt, seed=seed, candidates=candidates)
            else:
                # Fallback for already-running app instances where TestingService wasn't reloaded yet.
                rep = self.service._temp_rollup.export_distinct_experiment_report(pt, seed=seed, candidates=candidates)  # type: ignore[attr-defined]
        except Exception as exc:
            self.result_ready.emit({"ok": False, "message": f"Distinct coefs export failed: {exc}", "errors": [str(exc)]})
            return

        self.result_ready.emit(
            {
                "ok": True,
                "message": f"Distinct coefs complete: exported {int(rep.get('candidate_count') or 0)} candidates.",
                "report": rep,
                "seed": seed,
            }
        )


class PlateTypeStageSplitMAEWorker(QtCore.QThread):
    """Export per-test best unified coef by MAE for BW and DB stages (non-baseline tests only)."""

    result_ready = QtCore.Signal(dict)
    status_ready = QtCore.Signal(dict)

    def __init__(self, service: TestingService, plate_type: str, mode: str = "scalar"):
        super().__init__()
        self.service = service
        self.plate_type = str(plate_type or "").strip()
        self.mode = str(mode or "scalar").strip().lower()

    def run(self) -> None:
        try:
            self.status_ready.emit({"status": "running", "message": f"Unified + k: exporting per-test report for plate {self.plate_type}…"})
        except Exception:
            pass

        try:
            res = dict(self.service.export_stage_split_mae_per_test_report(self.plate_type, mode=self.mode, status_cb=self.status_ready.emit) or {})
            ok = bool(res.get("ok"))
            csv_path = str(res.get("csv_path") or "")
            errs = list(res.get("errors") or [])
            msg = str(res.get("message") or ("Report exported" if ok else "Report failed"))
            payload = {"ok": ok, "message": msg, "errors": errs, "best": None}
            if csv_path:
                payload["report"] = {"kind": "stage_split", "csv_path": csv_path}
            if isinstance(res.get("summary"), dict):
                payload["summary"] = dict(res.get("summary") or {})
            self.result_ready.emit(payload)
        except Exception as exc:
            self.result_ready.emit({"ok": False, "message": str(exc), "errors": [str(exc)], "best": None})


class PostCaptureAutoSyncWorker(QtCore.QThread):
    """Fire-and-forget worker that trims a just-captured raw CSV and uploads to Supabase.

    Designed to run right after a live capture session ends.  All steps are
    wrapped in try/except so failures are logged but never propagated.
    """

    sync_status = QtCore.Signal(str, str)  # (message, color)

    def __init__(self, capture_name: str, csv_dir: str, device_id: str, session_meta: dict):
        super().__init__()
        self.capture_name = str(capture_name or "")
        self.csv_dir = str(csv_dir or "")
        self.device_id = str(device_id or "")
        self.session_meta = dict(session_meta or {})

    def run(self) -> None:
        import json
        import logging
        import time as _time

        _log = logging.getLogger(__name__)

        try:
            capture = self.capture_name
            csv_dir = self.csv_dir
            device_id = self.device_id
            if not capture or not csv_dir or not device_id:
                return

            meta_path = os.path.join(csv_dir, f"{capture}.meta.json")
            raw_csv = os.path.join(csv_dir, f"{capture}.csv")

            # The backend has already confirmed the CSV is fully written
            # (stopCaptureStatus), so we just verify it exists.
            if not os.path.isfile(raw_csv):
                _log.warning("PostCaptureAutoSync: raw CSV not found for %s", capture)
                return

            # Create/update meta JSON with session info.
            meta: dict = {}
            if os.path.isfile(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as fh:
                        meta = json.load(fh) or {}
                except Exception:
                    meta = {}
            # Merge in session metadata from the live test.
            meta.setdefault("device_id", device_id)
            for k, v in self.session_meta.items():
                if v is not None:
                    meta.setdefault(k, v)
            meta["capture_name"] = capture

            # Trim: downsample raw to 50 Hz.
            trimmed_name = capture.replace("temp-raw-", "temp-trimmed-")
            trimmed_csv = os.path.join(csv_dir, f"{trimmed_name}.csv")
            try:
                from ...app_services.repositories.csv_transform_repository import CsvTransformRepository
                CsvTransformRepository().downsample_csv_to_50hz(raw_csv, trimmed_csv)
            except Exception as exc:
                _log.warning("PostCaptureAutoSync: trim failed: %s", exc)
                return

            # Update meta with trimmed CSV info and write to disk.
            baseline = meta.get("processed_baseline")
            if not isinstance(baseline, dict):
                baseline = {}
            baseline["trimmed_csv"] = f"{trimmed_name}.csv"
            baseline["updated_at_ms"] = int(_time.time() * 1000)
            meta["processed_baseline"] = baseline
            try:
                os.makedirs(os.path.dirname(meta_path), exist_ok=True)
                with open(meta_path, "w", encoding="utf-8") as fh:
                    json.dump(meta, fh, indent=2, sort_keys=True)
            except Exception as exc:
                _log.warning("PostCaptureAutoSync: meta write failed: %s", exc)

            # Upload to Supabase.
            self.sync_status.emit("Uploading…", "")
            try:
                from ...infra.supabase_temp_repo import SupabaseTempRepository

                repo = SupabaseTempRepository()
                trimmed_storage = repo.upload_csv_gzipped(trimmed_csv, device_id)
                session_id = repo.upsert_session(
                    meta, meta_path, trimmed_csv_storage_path=trimmed_storage,
                )
                if session_id:
                    # Stamp synced_at_ms so background sync skips this session.
                    meta["synced_at_ms"] = int(_time.time() * 1000)
                    try:
                        with open(meta_path, "w", encoding="utf-8") as fh:
                            json.dump(meta, fh, indent=2, sort_keys=True)
                    except Exception:
                        pass
                    _log.info("PostCaptureAutoSync: uploaded session %s", session_id)
                    self.sync_status.emit("Uploaded successfully", "#2e7d32")
            except Exception as exc:
                self.sync_status.emit("", "")
                _log.warning("PostCaptureAutoSync: Supabase upload failed: %s", exc)

        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("PostCaptureAutoSyncWorker failed: %s", exc)


class SupabaseUploadWorker(QtCore.QThread):
    """Fire-and-forget worker that syncs a temperature test session to Supabase."""

    def __init__(self, meta_path: str):
        super().__init__()
        self.meta_path = str(meta_path or "")

    def run(self) -> None:
        try:
            from ...infra.supabase_temp_repo import SupabaseTempRepository

            repo = SupabaseTempRepository()
            repo.sync_session_from_meta(self.meta_path)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "SupabaseUploadWorker failed: %s", exc
            )


class SupabaseBulkUploadWorker(QtCore.QThread):
    """Background worker that uploads all temperature test sessions from a folder to Supabase."""

    progress = QtCore.Signal(int, int)  # current, total
    finished_with_result = QtCore.Signal(dict)  # {ok, uploaded, skipped, errors}

    def __init__(self, folder: str):
        super().__init__()
        self.folder = str(folder or "")

    def run(self) -> None:
        import glob
        import logging

        _log = logging.getLogger(__name__)
        meta_files = sorted(glob.glob(os.path.join(self.folder, "**", "*.meta.json"), recursive=True))
        total = len(meta_files)
        uploaded = 0
        skipped = 0
        errors: List[str] = []

        if total == 0:
            self.finished_with_result.emit({"ok": True, "uploaded": 0, "skipped": 0, "errors": ["No *.meta.json files found in folder."]})
            return

        try:
            from ...infra.supabase_temp_repo import SupabaseTempRepository
            repo = SupabaseTempRepository()
        except Exception as exc:
            self.finished_with_result.emit({"ok": False, "uploaded": 0, "skipped": 0, "errors": [f"Failed to initialise Supabase client: {exc}"]})
            return

        for i, meta_path in enumerate(meta_files):
            self.progress.emit(i, total)
            try:
                repo.sync_session_from_meta(meta_path)
                uploaded += 1
            except Exception as exc:
                _log.warning("Bulk upload failed for %s: %s", meta_path, exc)
                errors.append(f"{os.path.basename(meta_path)}: {exc}")
                skipped += 1

        self.progress.emit(total, total)
        self.finished_with_result.emit({
            "ok": not errors,
            "uploaded": uploaded,
            "skipped": skipped,
            "errors": errors,
        })


def sync_down_device(
    repo: object,
    device_id: str,
    local_dir: str,
    *,
    skip_captures: set | None = None,
    log: object | None = None,
) -> dict:
    """Download remote temperature test sessions for a single device.

    Shared logic used by both SupabaseSyncDownWorker (single device, on-demand)
    and BackgroundSyncWorker (all devices, periodic).

    Returns ``{"downloaded": int, "errors": list[str]}``.
    """
    import json
    import logging
    import time as _time

    _log = log or logging.getLogger(__name__)
    downloaded = 0
    errors: List[str] = []
    skip = skip_captures or set()

    os.makedirs(local_dir, exist_ok=True)

    all_sessions = repo.list_sessions_for_device(device_id)
    if not all_sessions:
        return {"downloaded": 0, "errors": []}

    # Build full lookup before filtering (needed by orphan-meta pass).
    all_sessions_by_capture = {str(s.get("capture_name") or ""): s for s in all_sessions}

    sessions = all_sessions
    if skip:
        sessions = [s for s in sessions if str(s.get("capture_name") or "") not in skip]

    for s in sessions:
        capture_name = str(s.get("capture_name") or "")
        if not capture_name:
            continue

        meta_filename = f"{capture_name}.meta.json"
        local_meta = os.path.join(local_dir, meta_filename)

        # Reconstruct meta JSON from DB data if not present locally.
        if not os.path.isfile(local_meta):
            try:
                meta = {
                    "device_id": device_id,
                    "capture_name": capture_name,
                    "model_id": s.get("model_id"),
                    "tester_name": s.get("tester_name"),
                    "body_weight_n": s.get("body_weight_n"),
                    "avg_temp": s.get("avg_temp"),
                    "short_label": s.get("short_label"),
                    "date": s.get("date"),
                    "started_at_ms": s.get("started_at_ms"),
                    "synced_at_ms": int(_time.time() * 1000),
                }
                meta = {k: v for k, v in meta.items() if v is not None}
                os.makedirs(os.path.dirname(local_meta), exist_ok=True)
                with open(local_meta, "w", encoding="utf-8") as fh:
                    json.dump(meta, fh, indent=2, sort_keys=True)
                downloaded += 1
            except Exception as exc:
                errors.append(f"meta reconstruct {capture_name}: {exc}")
                continue

        # Download trimmed CSV from session row.
        storage_path = str(s.get("trimmed_csv_storage_path") or "")
        if storage_path:
            remote_basename = os.path.basename(storage_path)
            local_name = remote_basename[:-3] if remote_basename.endswith(".gz") else remote_basename
            local_csv = os.path.join(local_dir, local_name)
            if not os.path.isfile(local_csv):
                try:
                    ok = repo.download_csv_gunzipped(storage_path, local_csv)
                    if ok:
                        _log.info("sync_down_device: downloaded %s", local_name)
                        downloaded += 1
                except Exception as exc:
                    errors.append(f"download {storage_path}: {exc}")

    # --- Orphan-meta pass: local metas that are missing their CSV ---
    for fname in os.listdir(local_dir):
        if not fname.endswith(".meta.json"):
            continue
        meta_path = os.path.join(local_dir, fname)
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh) or {}
        except Exception:
            continue

        capture_name = str(meta.get("capture_name") or "")
        if not capture_name:
            continue

        # Check if at least a raw or trimmed CSV exists locally.
        trimmed_name = capture_name.replace("temp-raw-", "temp-trimmed-")
        raw_csv = os.path.join(local_dir, f"{capture_name}.csv")
        trimmed_csv = os.path.join(local_dir, f"{trimmed_name}.csv")
        if os.path.isfile(raw_csv) or os.path.isfile(trimmed_csv):
            continue

        # No CSV on disk — try to download from Supabase.
        s = all_sessions_by_capture.get(capture_name)
        if not s:
            continue
        storage_path = str(s.get("trimmed_csv_storage_path") or "")
        if not storage_path:
            continue
        remote_basename = os.path.basename(storage_path)
        local_name = remote_basename[:-3] if remote_basename.endswith(".gz") else remote_basename
        local_csv = os.path.join(local_dir, local_name)
        if os.path.isfile(local_csv):
            continue
        try:
            ok = repo.download_csv_gunzipped(storage_path, local_csv)
            if ok:
                _log.info("sync_down_device: recovered missing CSV %s", local_name)
                downloaded += 1
        except Exception as exc:
            errors.append(f"recover CSV {capture_name}: {exc}")

    return {"downloaded": downloaded, "errors": errors}


class SupabaseSyncDownWorker(QtCore.QThread):
    """Background worker that downloads remote temperature test sessions not present locally."""

    finished_with_result = QtCore.Signal(dict)  # {"downloaded": int, "errors": list}

    def __init__(self, device_id: str, local_dir: str):
        super().__init__()
        self.device_id = str(device_id or "")
        self.local_dir = str(local_dir or "")

    def run(self) -> None:
        try:
            from ...infra.supabase_temp_repo import SupabaseTempRepository

            repo = SupabaseTempRepository()
            if repo._sb is None:
                self.finished_with_result.emit({"downloaded": 0, "errors": []})
                return

            result = sync_down_device(repo, self.device_id, self.local_dir)
            self.finished_with_result.emit(result)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("SupabaseSyncDownWorker failed: %s", exc)
            self.finished_with_result.emit({"downloaded": 0, "errors": [str(exc)]})


class BackgroundSyncWorker(QtCore.QThread):
    """Periodic background worker that uploads unsynced sessions and pulls new remote ones.

    Designed to be kicked off by a QTimer every few minutes.  Completely
    silent — failures are logged but never surfaced to the user.
    """

    finished_with_result = QtCore.Signal(dict)  # {"uploaded": int, "downloaded": int}
    sync_progress = QtCore.Signal(str, str)  # (message, level: "info"|"success"|"error")

    def __init__(self, temp_testing_root: str):
        super().__init__()
        self.temp_testing_root = str(temp_testing_root or "")

    def run(self) -> None:
        import json
        import logging
        import time as _time

        _log = logging.getLogger(__name__)
        uploaded = 0
        downloaded = 0

        try:
            self.sync_progress.emit("Background sync started\u2026", "info")

            from ...infra.supabase_temp_repo import SupabaseTempRepository

            repo = SupabaseTempRepository()
            if repo._sb is None:
                self.sync_progress.emit("Sync skipped (no Supabase client)", "info")
                self.finished_with_result.emit({"uploaded": 0, "downloaded": 0})
                return

            root = self.temp_testing_root
            if not os.path.isdir(root):
                self.sync_progress.emit("Sync skipped (no data folder)", "info")
                self.finished_with_result.emit({"uploaded": 0, "downloaded": 0})
                return

            # --- Filename fix + organization + repair pass ---
            try:
                fix = _fix_csv_filenames(root)
                if fix.get("renamed"):
                    _log.info("BackgroundSync: renamed %d misnamed files", fix["renamed"])
                # Delete stale Supabase records for the old (wrong) capture names
                # so the corrected session is re-uploaded cleanly.
                stale_names = fix.get("old_capture_names") or []
                if stale_names:
                    try:
                        n = repo.delete_sessions_by_capture_names(stale_names)
                        if n:
                            _log.info("BackgroundSync: deleted %d stale Supabase records", n)
                    except Exception:
                        pass
            except Exception as exc:
                _log.debug("BackgroundSync: filename fix pass failed: %s", exc)
            try:
                org = _organize_temp_files(root)
                if org.get("moved"):
                    _log.info("BackgroundSync: organized %d misplaced files", org["moved"])
            except Exception as exc:
                _log.debug("BackgroundSync: organize pass failed: %s", exc)
            try:
                cre = _create_missing_meta_files(root)
                if cre.get("created"):
                    _log.info("BackgroundSync: created %d missing meta files", cre["created"])
                    self.sync_progress.emit(f"Created {cre['created']} missing meta files", "info")
            except Exception as exc:
                _log.debug("BackgroundSync: create-missing-meta pass failed: %s", exc)
            try:
                rep = _repair_temp_files(root)
                if rep.get("trimmed_created") or rep.get("avg_temp_filled") or rep.get("date_filled"):
                    _log.info(
                        "BackgroundSync: repaired %d trimmed CSVs, %d avg_temp, %d date values",
                        rep.get("trimmed_created", 0),
                        rep.get("avg_temp_filled", 0),
                        rep.get("date_filled", 0),
                    )
                    parts = []
                    if rep.get("trimmed_created"):
                        parts.append(f"{rep['trimmed_created']} trimmed CSVs")
                    if rep.get("avg_temp_filled"):
                        parts.append(f"{rep['avg_temp_filled']} temps")
                    if rep.get("date_filled"):
                        parts.append(f"{rep['date_filled']} dates")
                    self.sync_progress.emit(f"Repaired: {', '.join(parts)}", "info")
            except Exception as exc:
                _log.debug("BackgroundSync: repair pass failed: %s", exc)

            # --- Upload pass: find unsynced *.meta.json files ---
            # First, ask Supabase which capture_names already exist so we
            # never re-upload sessions that are already remote.
            try:
                remote_captures = repo.list_all_capture_names()
            except Exception:
                remote_captures = set()

            # Also fetch soft-deleted capture names so we never re-upload
            # sessions that were intentionally trashed.
            try:
                deleted_captures = repo.list_deleted_capture_names()
            except Exception:
                deleted_captures = set()

            uploaded_captures: set = set()  # track what we upload → skip in download pass
            for device_dir in _listdir_dirs(root):
                device_id = os.path.basename(device_dir)
                device_uploaded = 0
                for fname in os.listdir(device_dir):
                    if not fname.endswith(".meta.json"):
                        continue
                    meta_path = os.path.join(device_dir, fname)
                    try:
                        with open(meta_path, "r", encoding="utf-8") as fh:
                            meta = json.load(fh) or {}
                    except Exception:
                        continue

                    capture_name = str(meta.get("capture_name") or "")

                    # Skip soft-deleted sessions — don't re-upload trashed tests.
                    if capture_name and capture_name in deleted_captures:
                        uploaded_captures.add(capture_name)
                        _log.debug("BackgroundSync: %s is soft-deleted — skipping upload", capture_name)
                        continue

                    # Fast path: already marked synced locally and file unchanged.
                    # But only skip the download pass if we actually have a CSV
                    # on disk — orphaned metas still need their CSV recovered.
                    synced_at = meta.get("synced_at_ms")
                    if synced_at:
                        file_mtime_ms = int(os.path.getmtime(meta_path) * 1000)
                        if file_mtime_ms <= int(synced_at):
                            # Check if CSV exists before skipping download
                            _cn = capture_name
                            _tn = _cn.replace("temp-raw-", "temp-trimmed-")
                            has_csv = (
                                os.path.isfile(os.path.join(device_dir, f"{_cn}.csv"))
                                or os.path.isfile(os.path.join(device_dir, f"{_tn}.csv"))
                            )
                            if has_csv:
                                uploaded_captures.add(capture_name)
                            continue

                    # Check Supabase: if the session already exists remotely
                    # and the local file hasn't been modified since its own
                    # synced_at, just stamp synced_at_ms locally and skip.
                    if capture_name and capture_name in remote_captures:
                        try:
                            meta["synced_at_ms"] = int(_time.time() * 1000)
                            with open(meta_path, "w", encoding="utf-8") as fh:
                                json.dump(meta, fh, indent=2, sort_keys=True)
                        except Exception:
                            pass
                        # Only mark as uploaded (skip download) if CSV exists locally
                        _cn = capture_name
                        _tn = _cn.replace("temp-raw-", "temp-trimmed-")
                        has_csv = (
                            os.path.isfile(os.path.join(device_dir, f"{_cn}.csv"))
                            or os.path.isfile(os.path.join(device_dir, f"{_tn}.csv"))
                        )
                        if has_csv:
                            uploaded_captures.add(capture_name)
                        _log.debug("BackgroundSync: %s already in Supabase — stamped synced_at_ms", capture_name)
                        continue

                    if device_uploaded == 0:
                        self.sync_progress.emit(f"Uploading {device_id} tests\u2026", "info")

                    # --- Ensure trimmed CSV exists locally ---
                    # If the PostCaptureAutoSyncWorker didn't run (or
                    # failed), the trimmed CSV may be missing.  Create it
                    # from the raw CSV so both the local file and the
                    # Supabase upload are complete.
                    meta_dirty = False
                    try:
                        baseline = meta.get("processed_baseline")
                        if not isinstance(baseline, dict):
                            baseline = {}
                        has_trimmed = bool(baseline.get("trimmed_csv"))

                        if not has_trimmed and capture_name:
                            raw_csv = os.path.join(device_dir, f"{capture_name}.csv")
                            if os.path.isfile(raw_csv):
                                trimmed_name = capture_name.replace("temp-raw-", "temp-trimmed-")
                                trimmed_csv = os.path.join(device_dir, f"{trimmed_name}.csv")
                                if not os.path.isfile(trimmed_csv):
                                    try:
                                        from ...app_services.repositories.csv_transform_repository import CsvTransformRepository
                                        CsvTransformRepository().downsample_csv_to_50hz(raw_csv, trimmed_csv)
                                        _log.info("BackgroundSync: created trimmed CSV for %s", capture_name)
                                    except Exception as exc:
                                        _log.debug("BackgroundSync: trim failed for %s: %s", capture_name, exc)
                                        trimmed_csv = None
                                # Update meta with trimmed CSV info.
                                if trimmed_csv and os.path.isfile(trimmed_csv):
                                    baseline["trimmed_csv"] = f"{trimmed_name}.csv"
                                    baseline["updated_at_ms"] = int(_time.time() * 1000)
                                    meta["processed_baseline"] = baseline
                                    meta_dirty = True
                    except Exception as exc:
                        _log.debug("BackgroundSync: trim-check failed for %s: %s", fname, exc)

                    # Upload via the existing orchestrator.
                    try:
                        # Persist any local changes (trimmed CSV info) before uploading.
                        if meta_dirty:
                            with open(meta_path, "w", encoding="utf-8") as fh:
                                json.dump(meta, fh, indent=2, sort_keys=True)

                        repo.sync_session_from_meta(meta_path)

                        # Stamp synced_at_ms so we don't re-upload next cycle.
                        try:
                            meta["synced_at_ms"] = int(_time.time() * 1000)
                            with open(meta_path, "w", encoding="utf-8") as fh:
                                json.dump(meta, fh, indent=2, sort_keys=True)
                        except Exception as exc:
                            _log.warning("BackgroundSync: failed to write synced_at_ms for %s: %s", fname, exc)
                        uploaded += 1
                        device_uploaded += 1
                        uploaded_captures.add(capture_name)
                    except Exception as exc:
                        _log.debug("BackgroundSync: upload failed for %s: %s", fname, exc)

            # --- Download pass: pull new remote sessions per device ---
            # Discover ALL devices from Supabase (not just local folders)
            # so that tests done on other machines are synced down too.
            try:
                remote_device_ids = repo.list_all_device_ids()
            except Exception:
                remote_device_ids = []
            local_device_ids = {os.path.basename(d) for d in _listdir_dirs(root)}
            all_device_ids = sorted(local_device_ids | set(remote_device_ids))

            for device_id in all_device_ids:
                device_dir = os.path.join(root, device_id)
                try:
                    self.sync_progress.emit(f"Downloading {device_id} tests\u2026", "info")
                    result = sync_down_device(
                        repo, device_id, device_dir,
                        skip_captures=uploaded_captures, log=_log,
                    )
                    downloaded += int(result.get("downloaded", 0))
                except Exception as exc:
                    _log.debug("BackgroundSync: sync-down failed for %s: %s", device_id, exc)

        except Exception as exc:
            import logging
            logging.getLogger(__name__).debug("BackgroundSyncWorker failed: %s", exc)
            self.sync_progress.emit(f"Sync error: {exc}", "error")

        if uploaded or downloaded:
            self.sync_progress.emit(
                f"Sync complete: {uploaded} uploaded, {downloaded} downloaded", "success"
            )
        else:
            self.sync_progress.emit("Sync complete: everything up to date", "success")
        self.finished_with_result.emit({"uploaded": uploaded, "downloaded": downloaded})


def _fix_csv_filenames(root: str) -> dict:
    """Rename temp CSV files whose filename device_id doesn't match the data inside.

    The ``device_id`` column in the CSV is the source of truth.  If the
    filename contains a different device_id (e.g. from a zombie capture),
    the file — and its associated meta.json / trimmed CSV — are renamed.

    Must run **before** ``_organize_temp_files`` so that renamed files land
    in the correct device folder during the organize pass.

    Returns ``{"renamed": int, "old_capture_names": list[str], "errors": list[str]}``.
    """
    import csv
    import glob
    import json
    import logging
    import re

    _log = logging.getLogger(__name__)
    renamed = 0
    old_capture_names: List[str] = []
    errors: List[str] = []

    if not os.path.isdir(root):
        return {"renamed": renamed, "old_capture_names": old_capture_names, "errors": errors}

    # Match both raw and trimmed CSVs.
    patterns = [
        os.path.join(root, "**", "temp-raw-*.csv"),
        os.path.join(root, "**", "temp-trimmed-*.csv"),
    ]
    seen_paths: set = set()
    for pattern in patterns:
        for csv_path in glob.glob(pattern, recursive=True):
            if csv_path in seen_paths:
                continue
            seen_paths.add(csv_path)

            basename = os.path.basename(csv_path)
            parent_dir = os.path.dirname(csv_path)

            # Extract device_id from the filename.
            # Pattern: temp-raw-<device_id>-<timestamp>.csv
            #      or: temp-trimmed-<device_id>-<timestamp>.csv
            m = re.match(r"temp-(?:raw|trimmed)-([^-]+(?:\.[^-]+)*)-(\d{8}-\d{6})\.csv$", basename)
            if not m:
                continue
            filename_device_id = m.group(1)
            timestamp_part = m.group(2)

            # Read device_id from the CSV content (first data row).
            csv_device_id = ""
            try:
                with open(csv_path, "r", encoding="utf-8", newline="") as fh:
                    reader = csv.DictReader(fh)
                    for row in reader:
                        raw = row.get("device_id") or row.get("device-id") or ""
                        csv_device_id = str(raw).strip()
                        break  # only need first row
            except Exception:
                continue

            if not csv_device_id or csv_device_id == filename_device_id:
                continue  # already correct or can't determine

            _log.info(
                "fix_filenames: %s has device_id=%s in data but %s in name — renaming",
                basename, csv_device_id, filename_device_id,
            )

            # Determine prefix (raw or trimmed) from current file.
            is_trimmed = basename.startswith("temp-trimmed-")
            prefix = "temp-trimmed" if is_trimmed else "temp-raw"
            new_basename = f"{prefix}-{csv_device_id}-{timestamp_part}.csv"
            new_path = os.path.join(parent_dir, new_basename)

            if os.path.exists(new_path):
                continue  # target already exists, don't overwrite

            # Track the old capture_name so Supabase records can be cleaned up.
            old_capture = f"temp-raw-{filename_device_id}-{timestamp_part}"
            added_this_iter = old_capture not in old_capture_names
            if added_this_iter:
                old_capture_names.append(old_capture)

            try:
                os.rename(csv_path, new_path)
                renamed += 1
            except Exception as exc:
                errors.append(f"rename {csv_path}: {exc}")
                if added_this_iter:
                    old_capture_names.remove(old_capture)
                continue

            # Rename the sibling (raw↔trimmed) if it exists with the old name.
            sibling_prefix = "temp-raw" if is_trimmed else "temp-trimmed"
            old_sibling = os.path.join(parent_dir, f"{sibling_prefix}-{filename_device_id}-{timestamp_part}.csv")
            if os.path.isfile(old_sibling):
                new_sibling = os.path.join(parent_dir, f"{sibling_prefix}-{csv_device_id}-{timestamp_part}.csv")
                if not os.path.exists(new_sibling):
                    try:
                        os.rename(old_sibling, new_sibling)
                        renamed += 1
                        seen_paths.add(old_sibling)
                    except Exception as exc:
                        errors.append(f"rename sibling {old_sibling}: {exc}")

            # Rename the meta.json if it exists with the old capture name.
            old_meta = os.path.join(parent_dir, f"temp-raw-{filename_device_id}-{timestamp_part}.meta.json")
            if os.path.isfile(old_meta):
                new_meta = os.path.join(parent_dir, f"temp-raw-{csv_device_id}-{timestamp_part}.meta.json")
                if not os.path.exists(new_meta):
                    try:
                        os.rename(old_meta, new_meta)
                        renamed += 1
                    except Exception as exc:
                        errors.append(f"rename meta {old_meta}: {exc}")

                # Also update capture_name and device_id inside the meta.
                meta_to_update = new_meta if os.path.isfile(new_meta) else old_meta
                if os.path.isfile(meta_to_update):
                    try:
                        with open(meta_to_update, "r", encoding="utf-8") as fh:
                            meta = json.load(fh) or {}
                        changed = False
                        new_capture_name = f"temp-raw-{csv_device_id}-{timestamp_part}"
                        if meta.get("capture_name") != new_capture_name:
                            meta["capture_name"] = new_capture_name
                            changed = True
                        if meta.get("device_id") != csv_device_id:
                            meta["device_id"] = csv_device_id
                            changed = True
                        # Clear synced_at_ms so the upload pass treats this as
                        # a fresh unsynced session after the rename.
                        if "synced_at_ms" in meta:
                            del meta["synced_at_ms"]
                            changed = True
                        if changed:
                            with open(meta_to_update, "w", encoding="utf-8") as fh:
                                json.dump(meta, fh, indent=2, sort_keys=True)
                    except Exception as exc:
                        errors.append(f"update meta content {meta_to_update}: {exc}")

    return {"renamed": renamed, "old_capture_names": old_capture_names, "errors": errors}


def _organize_temp_files(root: str) -> dict:
    """Move misplaced temp test files to their correct ``device_id`` folders.

    Scans every ``*.meta.json`` under *root*, reads the ``device_id`` field,
    and moves the meta + associated CSVs to ``<root>/<device_id>/`` when they
    reside in the wrong subfolder.  Orphan CSVs matching the
    ``temp-raw-<device>-*.csv`` naming pattern are also relocated.

    Returns ``{"moved": int, "errors": list[str]}``.
    """
    import glob
    import json
    import logging
    import re
    import shutil

    _log = logging.getLogger(__name__)
    moved = 0
    errors: List[str] = []

    if not os.path.isdir(root):
        return {"moved": moved, "errors": errors}

    # --- Pass 1: meta.json-guided moves ---
    meta_files = glob.glob(os.path.join(root, "**", "*.meta.json"), recursive=True)
    for meta_path in meta_files:
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh) or {}
        except Exception:
            continue

        device_id = str(meta.get("device_id") or "").strip()
        capture_name = str(meta.get("capture_name") or "").strip()

        # Fallback: extract device_id from filename  temp-raw-<device>-<timestamp>.meta.json
        if not device_id and capture_name:
            m = re.match(r"temp-raw-([^-]+(?:\.[^-]+)*)-", capture_name)
            if m:
                device_id = m.group(1)

        if not device_id:
            continue

        parent_dir = os.path.dirname(meta_path)
        parent_name = os.path.basename(parent_dir)
        if parent_name == device_id:
            continue  # already in correct folder

        dest_dir = os.path.join(root, device_id)
        os.makedirs(dest_dir, exist_ok=True)

        # Collect associated files: meta, raw csv, trimmed csv
        files_to_move = [meta_path]
        if capture_name:
            raw_csv = os.path.join(parent_dir, f"{capture_name}.csv")
            if os.path.isfile(raw_csv):
                files_to_move.append(raw_csv)
            trimmed_name = capture_name.replace("temp-raw-", "temp-trimmed-")
            trimmed_csv = os.path.join(parent_dir, f"{trimmed_name}.csv")
            if os.path.isfile(trimmed_csv):
                files_to_move.append(trimmed_csv)

        for src in files_to_move:
            dst = os.path.join(dest_dir, os.path.basename(src))
            if os.path.exists(dst):
                continue  # don't overwrite existing files
            try:
                shutil.move(src, dst)
                moved += 1
                _log.info("organize: moved %s -> %s", src, dest_dir)
            except Exception as exc:
                errors.append(f"move {src}: {exc}")

    # --- Pass 2: orphan CSVs (no matching meta in same dir) ---
    csv_files = glob.glob(os.path.join(root, "**", "temp-raw-*.csv"), recursive=True)
    for csv_path in csv_files:
        parent_dir = os.path.dirname(csv_path)
        basename = os.path.basename(csv_path)

        # Check if a meta.json already exists alongside (it may have been moved in pass 1)
        meta_candidate = os.path.join(parent_dir, basename.replace(".csv", ".meta.json"))
        if os.path.isfile(meta_candidate):
            continue  # not orphan — handled by pass 1

        m = re.match(r"temp-raw-([^-]+(?:\.[^-]+)*)-", basename)
        if not m:
            continue
        device_id = m.group(1)
        parent_name = os.path.basename(parent_dir)
        if parent_name == device_id:
            continue  # already in correct folder

        dest_dir = os.path.join(root, device_id)
        os.makedirs(dest_dir, exist_ok=True)
        dst = os.path.join(dest_dir, basename)
        if os.path.exists(dst):
            continue
        try:
            shutil.move(csv_path, dst)
            moved += 1
            _log.info("organize: moved orphan %s -> %s", csv_path, dest_dir)
        except Exception as exc:
            errors.append(f"move orphan {csv_path}: {exc}")

    return {"moved": moved, "errors": errors}


def _create_missing_meta_files(root: str) -> dict:
    """Auto-generate ``.meta.json`` for orphan ``temp-raw-*.csv`` files.

    Parses the filename to extract ``device_id`` and timestamp, then
    estimates ``avg_temp`` from the CSV data.  Returns
    ``{"created": int, "errors": list[str]}``.
    """
    import json
    import logging
    import re
    import time as _time

    _log = logging.getLogger(__name__)
    created = 0
    errors: List[str] = []

    if not os.path.isdir(root):
        return {"created": created, "errors": errors}

    # Pattern: temp-raw-<device_id>-<YYYYMMDD>-<HHMMSS>.csv
    # device_id can contain dots/hex, e.g. "06.00000042"
    fn_re = re.compile(
        r"^temp-raw-(.+)-(\d{8})-(\d{6})\.csv$", re.IGNORECASE
    )

    for device_dir_name in os.listdir(root):
        device_dir = os.path.join(root, device_dir_name)
        if not os.path.isdir(device_dir):
            continue
        for fname in os.listdir(device_dir):
            if not fname.lower().startswith("temp-raw-") or not fname.lower().endswith(".csv"):
                continue
            meta_name = fname[:-4] + ".meta.json"  # temp-raw-X.csv → temp-raw-X.meta.json
            meta_path = os.path.join(device_dir, meta_name)
            if os.path.isfile(meta_path):
                continue  # already has meta

            csv_path = os.path.join(device_dir, fname)
            stem = fname[:-4]  # strip .csv

            m = fn_re.match(fname)
            if not m:
                errors.append(f"unparseable filename: {fname}")
                continue

            device_id = m.group(1)
            date_str = m.group(2)  # YYYYMMDD
            time_str = m.group(3)  # HHMMSS

            # Build started_at_ms from timestamp.
            try:
                import datetime
                dt = datetime.datetime.strptime(
                    f"{date_str}{time_str}", "%Y%m%d%H%M%S"
                )
                started_at_ms = int(dt.timestamp() * 1000)
            except Exception:
                started_at_ms = None

            date_formatted = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

            avg_temp = _estimate_avg_temp(csv_path)

            meta = {
                "capture_name": stem,
                "device_id": device_id,
                "date": date_formatted,
                "avg_temp": avg_temp,
                "session_type": "temperature_test",
            }
            if started_at_ms is not None:
                meta["started_at_ms"] = started_at_ms

            try:
                with open(meta_path, "w", encoding="utf-8") as fh:
                    json.dump(meta, fh, indent=2, sort_keys=True)
                created += 1
                _log.info("Created missing meta for %s", stem)
            except Exception as exc:
                errors.append(f"write meta {stem}: {exc}")

    return {"created": created, "errors": errors}


def _repair_temp_files(root: str) -> dict:
    """Ensure every ``*.meta.json`` under *root* has a trimmed CSV and ``avg_temp``.

    * If a trimmed CSV is missing but the raw CSV exists, it is created via
      ``CsvTransformRepository().downsample_csv_to_50hz()``.
    * If ``avg_temp`` is absent, it is estimated from the raw/trimmed CSV
      using reservoir sampling on the ``sum-t`` column.

    Returns ``{"trimmed_created": int, "avg_temp_filled": int, "errors": list[str]}``.
    """
    import csv as _csv
    import glob
    import json
    import logging
    import random
    import time as _time

    _log = logging.getLogger(__name__)
    trimmed_created = 0
    avg_temp_filled = 0
    date_filled = 0
    errors: List[str] = []

    if not os.path.isdir(root):
        return {"trimmed_created": trimmed_created, "avg_temp_filled": avg_temp_filled, "date_filled": date_filled, "errors": errors}

    # For parsing date from capture_name: temp-raw-<device>-YYYYMMDD-HHMMSS
    import re
    _capture_date_re = re.compile(r"-(\d{8})-(\d{6})$")

    meta_files = glob.glob(os.path.join(root, "**", "*.meta.json"), recursive=True)
    for meta_path in meta_files:
        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh) or {}
        except Exception:
            continue

        capture_name = str(meta.get("capture_name") or "").strip()
        if not capture_name:
            continue

        parent_dir = os.path.dirname(meta_path)
        meta_dirty = False

        # --- Ensure trimmed CSV exists ---
        baseline = meta.get("processed_baseline")
        if not isinstance(baseline, dict):
            baseline = {}

        trimmed_name = str(baseline.get("trimmed_csv") or "")
        trimmed_csv = os.path.join(parent_dir, trimmed_name) if trimmed_name else ""

        if not trimmed_name or not os.path.isfile(trimmed_csv):
            raw_csv = os.path.join(parent_dir, f"{capture_name}.csv")
            if os.path.isfile(raw_csv):
                trimmed_stem = capture_name.replace("temp-raw-", "temp-trimmed-")
                trimmed_csv = os.path.join(parent_dir, f"{trimmed_stem}.csv")
                if not os.path.isfile(trimmed_csv):
                    try:
                        from ...app_services.repositories.csv_transform_repository import CsvTransformRepository
                        CsvTransformRepository().downsample_csv_to_50hz(raw_csv, trimmed_csv)
                        _log.info("repair: created trimmed CSV for %s", capture_name)
                        trimmed_created += 1
                    except Exception as exc:
                        errors.append(f"trim {capture_name}: {exc}")
                        trimmed_csv = ""

                if trimmed_csv and os.path.isfile(trimmed_csv):
                    baseline["trimmed_csv"] = f"{trimmed_stem}.csv"
                    baseline["updated_at_ms"] = int(_time.time() * 1000)
                    meta["processed_baseline"] = baseline
                    meta_dirty = True

        # --- Ensure avg_temp exists ---
        if meta.get("avg_temp") is None:
            # Try trimmed CSV first, fall back to raw
            csv_for_avg = ""
            trimmed_ref = str(baseline.get("trimmed_csv") or "")
            if trimmed_ref:
                candidate = os.path.join(parent_dir, trimmed_ref)
                if os.path.isfile(candidate):
                    csv_for_avg = candidate
            if not csv_for_avg:
                raw_csv = os.path.join(parent_dir, f"{capture_name}.csv")
                if os.path.isfile(raw_csv):
                    csv_for_avg = raw_csv

            if csv_for_avg:
                avg = _estimate_avg_temp(csv_for_avg)
                if avg is not None:
                    meta["avg_temp"] = float(avg)
                    meta_dirty = True
                    avg_temp_filled += 1

        # --- Ensure date exists ---
        if not meta.get("date") and capture_name:
            dm = _capture_date_re.search(capture_name)
            if dm:
                ds = dm.group(1)  # YYYYMMDD
                meta["date"] = f"{ds[:4]}-{ds[4:6]}-{ds[6:8]}"
                meta_dirty = True
                date_filled += 1

        # Write back if changed
        if meta_dirty:
            try:
                with open(meta_path, "w", encoding="utf-8") as fh:
                    json.dump(meta, fh, indent=2, sort_keys=True)
            except Exception as exc:
                errors.append(f"meta write {capture_name}: {exc}")

    return {"trimmed_created": trimmed_created, "avg_temp_filled": avg_temp_filled, "date_filled": date_filled, "errors": errors}


def _estimate_avg_temp(csv_path: str, sample_size: int = 100) -> Optional[float]:
    """Reservoir-sample the ``sum-t`` column to estimate average temperature."""
    import csv as _csv
    import random

    if not os.path.isfile(csv_path):
        return None
    try:
        with open(csv_path, "r", newline="", encoding="utf-8") as handle:
            reader = _csv.reader(handle)
            header = next(reader, [])
            if not header:
                return None
            target_names = {"sum-t", "sum_t", "sumt"}
            col_idx = None
            for idx, name in enumerate(header):
                if name and name.strip().lower() in target_names:
                    col_idx = idx
                    break
            if col_idx is None:
                return None

            reservoir: List[float] = []
            seen = 0
            for row in reader:
                if len(row) <= col_idx:
                    continue
                try:
                    val = float(row[col_idx])
                except Exception:
                    continue
                seen += 1
                if len(reservoir) < sample_size:
                    reservoir.append(val)
                else:
                    j = random.randint(0, seen - 1)
                    if j < sample_size:
                        reservoir[j] = val
            if not reservoir:
                return None
            return sum(reservoir) / float(len(reservoir))
    except Exception:
        return None


def _estimate_body_weight_n(csv_path: str) -> Optional[float]:
    """Estimate body weight in Newtons from a temp CSV.

    Prefers ``Fz`` (calibrated) when available, otherwise falls back to
    ``sum-z`` (raw sensor sum).  The qualifying window is scale-dependent:
    - **Fz** (calibrated):  400–1500 N
    - **sum-z** (raw):      450–1200 N

    Returns the median of qualifying samples, or None if insufficient data.
    """
    import csv as _csv

    if not os.path.isfile(csv_path):
        return None
    try:
        with open(csv_path, "r", newline="", encoding="utf-8") as fh:
            reader = _csv.DictReader(fh)
            header_lower = {h.strip().lower(): h for h in (reader.fieldnames or [])}

            # Prefer calibrated Fz, fall back to raw sum-z
            fz_col = None
            is_calibrated = False
            if "fz" in header_lower:
                fz_col = header_lower["fz"]
                is_calibrated = True
            else:
                for candidate in ("sum-z", "sum_z", "sumz"):
                    if candidate in header_lower:
                        fz_col = header_lower[candidate]
                        break
            if fz_col is None:
                return None

            bw_lo = 400.0 if is_calibrated else 450.0
            bw_hi = 1500.0 if is_calibrated else 1200.0

            bw_samples: list[float] = []
            for row in reader:
                try:
                    fz = float(row.get(fz_col) or 0)
                except (TypeError, ValueError):
                    continue
                if bw_lo < fz < bw_hi:
                    bw_samples.append(fz)

            if len(bw_samples) < 100:
                return None
            bw_samples.sort()
            mid = len(bw_samples) // 2
            return bw_samples[mid]
    except Exception:
        return None


def _infer_missing_tester_and_weight(root: str) -> dict:
    """Cross-reference meta files to fill missing ``body_weight_n`` and ``tester_name``.

    For each meta missing these fields, estimates body weight from the raw
    CSV's Fz data, then searches all other metas (any plate) for a test
    on the same or nearby date with a known tester whose weight is within
    100 N.  If a match is found, copies both ``body_weight_n`` and
    ``tester_name`` from the match.

    Returns ``{"filled": int, "errors": list[str]}``.
    """
    import datetime
    import glob
    import json
    import logging

    _log = logging.getLogger(__name__)
    filled = 0
    errors: list[str] = []

    if not os.path.isdir(root):
        return {"filled": filled, "errors": errors}

    # --- Build a lookup of known testers: list of (date, weight, tester_name) ---
    known: list[tuple[str, float, str]] = []  # (YYYY-MM-DD, weight_n, name)
    all_metas = glob.glob(os.path.join(root, "**", "*.meta.json"), recursive=True)

    meta_cache: dict[str, dict] = {}
    for mp in all_metas:
        try:
            with open(mp, "r", encoding="utf-8") as fh:
                m = json.load(fh) or {}
            meta_cache[mp] = m
        except Exception:
            continue

    for mp, m in meta_cache.items():
        bw = m.get("body_weight_n")
        tn = m.get("tester_name")
        dt = m.get("date")
        if bw and tn and dt:
            try:
                known.append((str(dt), float(bw), str(tn)))
            except (TypeError, ValueError):
                pass

    if not known:
        return {"filled": filled, "errors": errors}

    def _parse_date(d: str) -> Optional[datetime.date]:
        for fmt in ("%Y-%m-%d", "%m-%d-%Y"):
            try:
                return datetime.datetime.strptime(d, fmt).date()
            except ValueError:
                continue
        return None

    # --- Find metas missing body_weight_n or tester_name ---
    for mp, m in meta_cache.items():
        if m.get("body_weight_n") and m.get("tester_name"):
            continue
        capture_name = str(m.get("capture_name") or "")
        if not capture_name:
            continue

        # Estimate body weight — prefer processed (calibrated Fz) > trimmed > raw
        parent_dir = os.path.dirname(mp)
        estimated_bw = None
        # Try processed baseline first
        pb = m.get("processed_baseline") or {}
        if isinstance(pb, dict) and pb.get("processed_off"):
            processed_csv = os.path.join(parent_dir, pb["processed_off"])
            if os.path.isfile(processed_csv):
                estimated_bw = _estimate_body_weight_n(processed_csv)
        if estimated_bw is None:
            trimmed_name = capture_name.replace("temp-raw-", "temp-trimmed-")
            trimmed_csv = os.path.join(parent_dir, f"{trimmed_name}.csv")
            if os.path.isfile(trimmed_csv):
                estimated_bw = _estimate_body_weight_n(trimmed_csv)
        if estimated_bw is None:
            raw_csv = os.path.join(parent_dir, f"{capture_name}.csv")
            estimated_bw = _estimate_body_weight_n(raw_csv)
        if estimated_bw is None:
            continue

        # Parse this file's date
        file_date = _parse_date(str(m.get("date") or ""))

        # Search for a matching known tester (within 100N, prefer same date)
        best_match: Optional[tuple[float, str]] = None  # (weight, name)
        best_date_dist = 9999

        for kd, kw, kn in known:
            if abs(kw - estimated_bw) > 100.0:
                continue
            kdate = _parse_date(kd)
            if file_date and kdate:
                dist = abs((file_date - kdate).days)
            else:
                dist = 9999
            if dist < best_date_dist:
                best_date_dist = dist
                best_match = (kw, kn)

        if best_match is None:
            continue

        matched_weight, matched_name = best_match

        # Use the matched tester's weight from the closest date
        dirty = False
        if not m.get("body_weight_n"):
            m["body_weight_n"] = matched_weight
            dirty = True
        if not m.get("tester_name"):
            m["tester_name"] = matched_name
            dirty = True

        if dirty:
            try:
                with open(mp, "w", encoding="utf-8") as fh:
                    json.dump(m, fh, indent=2, sort_keys=True)
                filled += 1
                _log.info(
                    "Inferred tester=%s weight=%.0fN for %s (estimated Fz=%.0fN, date_dist=%d days)",
                    matched_name, matched_weight, capture_name, estimated_bw, best_date_dist,
                )
            except Exception as exc:
                errors.append(f"write {capture_name}: {exc}")

    return {"filled": filled, "errors": errors}


class ThermalDriftWorker(QtCore.QThread):
    """Gather signed error vs temperature for all tests of a plate type.

    For each test:
    1. Ensure processed-off CSV exists (generates if needed)
    2. Run ``analyze_single_processed_csv`` to extract per-cell measurements
    3. Collect ``(avg_temp, stage_key, row, col, signed_pct, mean_n, device_id)``

    Emits ``result_ready`` with a dict containing ``"points"`` (list of dicts)
    and ``"errors"`` (list of strings).
    """

    result_ready = QtCore.Signal(dict)
    progress = QtCore.Signal(str)

    def __init__(self, service: TestingService, plate_type: str, device_id: str = None):
        super().__init__()
        self.service = service
        self.plate_type = str(plate_type or "").strip()
        self.device_id = str(device_id).strip() if device_id else None

    def run(self) -> None:
        import json
        import logging

        _log = logging.getLogger(__name__)
        points: List[dict] = []
        errors: List[str] = []

        try:
            repo = self.service.repo
            analyzer = self.service.analyzer
            processing = self.service._temp_processing

            if self.device_id:
                devices = [self.device_id]
            else:
                devices = [
                    d for d in (repo.list_temperature_devices() or [])
                    if d.split(".", 1)[0] == self.plate_type
                ]
            if not devices:
                self.result_ready.emit({"points": [], "errors": [f"No devices for plate type {self.plate_type}"]})
                return

            total_tests = 0
            processed_count = 0

            for device_id in devices:
                tests = repo.list_temperature_tests(device_id)
                total_tests += len(tests)

            self.progress.emit(f"Found {total_tests} tests across {len(devices)} devices")

            # Pre-load bias caches per device for bias-adjusted error
            bias_caches: dict[str, dict] = {}
            for device_id in devices:
                try:
                    bc = repo.load_temperature_bias_cache(device_id)
                    if isinstance(bc, dict) and (bc.get("bias_db") or bc.get("bias_bw")):
                        bias_caches[device_id] = bc
                except Exception:
                    pass

            for device_id in devices:
                tests = repo.list_temperature_tests(device_id)
                bias_cache = bias_caches.get(device_id) or {}
                bias_db = bias_cache.get("bias_db")  # rows x cols matrix or None
                bias_bw = bias_cache.get("bias_bw")

                for raw_csv in tests:
                    processed_count += 1
                    basename = os.path.basename(raw_csv)
                    capture = os.path.splitext(basename)[0]

                    # Load meta
                    meta_path = os.path.join(os.path.dirname(raw_csv), f"{capture}.meta.json")
                    if not os.path.isfile(meta_path):
                        continue
                    try:
                        with open(meta_path, "r", encoding="utf-8") as fh:
                            meta = json.load(fh) or {}
                    except Exception:
                        continue

                    avg_temp = meta.get("avg_temp")
                    body_weight = meta.get("body_weight_n")
                    if avg_temp is None:
                        errors.append(f"{capture}: missing avg_temp")
                        continue
                    if body_weight is None:
                        errors.append(f"{capture}: missing body_weight_n")
                        continue

                    # Ensure processed-off CSV exists
                    try:
                        processed_path = processing.ensure_temp_off_processed(
                            folder=os.path.dirname(raw_csv),
                            device_id=device_id,
                            csv_path=raw_csv,
                        )
                    except Exception as exc:
                        errors.append(f"{capture}: processing failed: {exc}")
                        continue

                    if not processed_path or not os.path.isfile(processed_path):
                        errors.append(f"{capture}: no processed CSV")
                        continue

                    # Analyze
                    try:
                        result = analyzer.analyze_single_processed_csv(processed_path, meta)
                    except Exception as exc:
                        errors.append(f"{capture}: analysis failed: {exc}")
                        continue

                    data = result.get("data") or {}
                    stages = data.get("stages") or {}

                    for stage_key, stage_data in stages.items():
                        cells = stage_data.get("cells") or []
                        target_n = stage_data.get("target_n")
                        bmap = bias_db if stage_key == "db" else bias_bw
                        for cell in cells:
                            row = cell.get("row")
                            col = cell.get("col")
                            mean_n = cell.get("mean_n")

                            # Compute bias-adjusted error if bias map available
                            bias_adj_pct = None
                            if bmap and isinstance(bmap, list) and mean_n is not None and target_n:
                                try:
                                    bias_frac = bmap[row][col]
                                    adj_target = target_n * (1.0 + bias_frac)
                                    if adj_target != 0:
                                        bias_adj_pct = ((mean_n - adj_target) / adj_target) * 100.0
                                except (IndexError, TypeError):
                                    pass

                            points.append({
                                "temp_f": float(avg_temp),
                                "stage": stage_key,
                                "row": row,
                                "col": col,
                                "signed_pct": cell.get("signed_pct"),
                                "bias_adj_pct": bias_adj_pct,
                                "mean_n": mean_n,
                                "target_n": target_n,
                                "device_id": device_id,
                                "capture": capture,
                            })

                    if processed_count % 5 == 0:
                        self.progress.emit(f"Analyzed {processed_count}/{total_tests} tests...")

            self.progress.emit(f"Done: {len(points)} measurement points from {processed_count} tests")

        except Exception as exc:
            _log.warning("ThermalDriftWorker failed: %s", exc)
            errors.append(str(exc))

        self.result_ready.emit({"points": points, "errors": errors, "device_id": self.device_id})


def _listdir_dirs(root: str) -> List[str]:
    """Return absolute paths of immediate subdirectories."""
    try:
        return [
            os.path.join(root, d)
            for d in os.listdir(root)
            if os.path.isdir(os.path.join(root, d))
        ]
    except OSError:
        return []
