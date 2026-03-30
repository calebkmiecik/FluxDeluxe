from __future__ import annotations

import csv
import os
from typing import Callable, Dict, List, Optional, Tuple

from ... import config
from ...project_paths import data_dir
from ..analysis.temperature_analyzer import TemperatureAnalyzer
from ..repositories.test_file_repository import TestFileRepository
from ..temperature_baseline_bias_service import TemperatureBaselineBiasService
from ..temperature_processing_service import TemperatureProcessingService
from .scoring import score_run_against_bias
from .unified_k import compute_c_and_k_from_stage_split_rows, evaluate_unified_k_bias_metrics, save_cache


def _plate_type_from_device_id(device_id: str) -> str:
    d = str(device_id or "").strip()
    if not d:
        return ""
    return d.split(".", 1)[0].strip()


def _quantize(v: float, step: float) -> float:
    if step <= 0:
        return float(v)
    return round(float(v) / float(step)) * float(step)


def _coef_key(mode: str, c: float) -> str:
    m = str(mode or "scalar").strip().lower()
    cc = float(c)
    return f"{m}:x={cc:.6f},y={cc:.6f},z={cc:.6f}"


def _find_processed_paths_for_coef(details: dict, *, mode: str, coef: float) -> tuple[str, str]:
    """
    Return (baseline_path, selected_path) for the given unified coef if present, else ("","").
    """
    baseline_path = ""
    selected_path = ""
    proc_runs_existing = list((details or {}).get("processed_runs") or [])
    ck = _coef_key(mode, coef)
    for r in proc_runs_existing:
        if r.get("is_baseline") and not baseline_path:
            baseline_path = str(r.get("path") or "")
            continue
    for r in proc_runs_existing:
        if r.get("is_baseline"):
            continue
        slopes = dict((r.get("slopes") or {}) if isinstance(r, dict) else {})
        try:
            rx = float(slopes.get("x", 0.0))
            ry = float(slopes.get("y", 0.0))
            rz = float(slopes.get("z", 0.0))
        except Exception:
            continue
        # Match unified coefs only; allow tiny float noise by rounding to 1e-6.
        if f"{float(rx):.6f}" == f"{float(coef):.6f}" and f"{float(ry):.6f}" == f"{float(coef):.6f}" and f"{float(rz):.6f}" == f"{float(coef):.6f}":
            rm = str(r.get("mode") or "").strip().lower() or "legacy"
            if rm == str(mode or "scalar").strip().lower():
                selected_path = str(r.get("path") or "")
                break
    return baseline_path, selected_path


def _ensure_eval_scores_for_coef(
    *,
    repo: TestFileRepository,
    analyzer: TemperatureAnalyzer,
    processing: TemperatureProcessingService,
    device_id: str,
    raw_csv: str,
    meta: dict,
    bias_map: list,
    coef: float,
    mode: str,
    cache: dict,
    status_cb: Callable[[dict], None] | None = None,
) -> Optional[dict]:
    """
    Ensure processed variant exists for unified coef, analyze baseline(off) vs selected(on),
    and return selected_scores {all, db, bw}.
    """
    c = max(0.0, min(0.02, float(coef)))
    c = _quantize(c, 0.0001)
    key = (str(raw_csv), f"{c:.6f}", str(mode or "scalar").strip().lower())
    if key in cache:
        return cache[key]

    details = repo.get_temperature_test_details(raw_csv)
    baseline_path, selected_path = _find_processed_paths_for_coef(details, mode=str(mode or "scalar"), coef=c)

    folder = os.path.dirname(raw_csv)
    room_temp_f = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))

    # If missing processed files, run processing for this coef (this also ensures baseline-off exists).
    if not (baseline_path and selected_path and os.path.isfile(baseline_path) and os.path.isfile(selected_path)):
        if status_cb is not None:
            try:
                status_cb(
                    {
                        "status": "running",
                        "message": f"{device_id}: processing {os.path.basename(raw_csv)} @ coef {c:.4f}",
                        "progress": 5,
                    }
                )
            except Exception:
                pass
        processing.run_temperature_processing(
            folder=folder,
            device_id=device_id,
            csv_path=raw_csv,
            slopes={"x": c, "y": c, "z": c},
            room_temp_f=room_temp_f,
            mode=str(mode or "scalar"),
            status_cb=status_cb,
        )
        details = repo.get_temperature_test_details(raw_csv)
        baseline_path, selected_path = _find_processed_paths_for_coef(details, mode=str(mode or "scalar"), coef=c)

    if not (baseline_path and selected_path and os.path.isfile(baseline_path) and os.path.isfile(selected_path)):
        cache[key] = None
        return None

    payload = analyzer.analyze_temperature_processed_runs(baseline_path, selected_path, meta)
    grid = dict(payload.get("grid") or {})
    device_type = str(grid.get("device_type") or _plate_type_from_device_id(device_id) or "")
    body_weight_n = float((payload.get("meta") or {}).get("body_weight_n") or 0.0)

    selected_scores = {
        k: score_run_against_bias(
            run_data=payload.get("selected") or {},
            stage_key=k,
            device_type=device_type,
            body_weight_n=body_weight_n,
            bias_map=bias_map,
        )
        for k in ("all", "db", "bw")
    }
    cache[key] = selected_scores
    return selected_scores


_SEED_COEFS: Dict[str, float] = {
    "06": 0.002, "07": 0.0025, "08": 0.0009,
    "10": 0.002, "11": 0.0025, "12": 0.0009,
}


def _best_unified_coef_for_test_stage_mae(
    *,
    repo: TestFileRepository,
    analyzer: TemperatureAnalyzer,
    processing: TemperatureProcessingService,
    device_id: str,
    raw_csv: str,
    meta: dict,
    bias_map: list,
    stage_key: str,
    mode: str,
    status_cb: Callable[[dict], None] | None,
    eval_cache: dict,
) -> Dict[str, object]:
    """
    Find best unified coef (x=y=z) for a single test+stage by bisecting on
    mean_signed error.  Signed error is monotonically decreasing in coef, so
    we just bracket the zero crossing and bisect.

    Strategy:
      - Seed from known plate-type coefs (e.g. 0.002 for type 06)
      - Coarse steps (0.0005) to bracket the sign flip
      - Linear-interpolation + bisection to refine to 0.0001
    """
    sk = str(stage_key or "").strip().lower()
    if sk not in ("db", "bw"):
        raise ValueError(f"Unsupported stage_key: {stage_key}")

    plate_type = str(device_id or "")[:2]
    seed = _SEED_COEFS.get(plate_type, 0.002)

    min_c = 0.0
    max_c = 0.005
    coarse_step = 0.0005
    fine_step = 0.0001

    # Track every evaluated point: coef -> (mean_signed, mean_abs)
    evaluated: Dict[float, Tuple[float, float]] = {}

    def _eval(c: float) -> Optional[Tuple[float, float]]:
        c = max(min_c, min(max_c, _quantize(c, fine_step)))
        if c in evaluated:
            return evaluated[c]
        scores = _ensure_eval_scores_for_coef(
            repo=repo,
            analyzer=analyzer,
            processing=processing,
            device_id=device_id,
            raw_csv=raw_csv,
            meta=meta,
            bias_map=bias_map,
            coef=c,
            mode=mode,
            cache=eval_cache,
            status_cb=status_cb,
        )
        if not isinstance(scores, dict):
            return None
        s = scores.get(sk)
        if not isinstance(s, dict):
            return None
        try:
            signed = float(s["mean_signed"])
            mae = float(s["mean_abs"])
        except (KeyError, TypeError, ValueError):
            return None
        evaluated[c] = (signed, mae)
        return (signed, mae)

    def _best_result() -> Dict[str, object]:
        if not evaluated:
            return {"ok": False, "best_coef": None, "best_mean_abs": None}
        best_c, (_, best_mae) = min(evaluated.items(), key=lambda x: abs(x[1][0]))
        return {"ok": True, "best_coef": float(best_c), "best_mean_abs": float(best_mae)}

    # --- Phase 1: Evaluate seed ---
    r = _eval(seed)
    if r is None:
        return {"ok": False, "best_coef": None, "best_mean_abs": None}
    s_seed = r[0]

    if abs(s_seed) < 0.05:
        return _best_result()

    # --- Phase 2: Bracket the zero crossing with coarse steps ---
    lo_c: Optional[float] = None
    lo_s: Optional[float] = None
    hi_c: Optional[float] = None
    hi_s: Optional[float] = None

    if s_seed > 0:
        # Signed error positive → need larger coef. Step upward.
        lo_c, lo_s = seed, s_seed
        c = _quantize(seed + coarse_step, fine_step)
        while c <= max_c:
            r = _eval(c)
            if r is not None:
                if r[0] <= 0:
                    hi_c, hi_s = c, r[0]
                    break
                lo_c, lo_s = c, r[0]
            c = _quantize(c + coarse_step, fine_step)
        else:
            # No sign flip. Also try the boundary.
            r = _eval(max_c)
            if r is not None and r[0] <= 0:
                hi_c, hi_s = max_c, r[0]
    else:
        # Signed error negative → need smaller coef. Step downward.
        hi_c, hi_s = seed, s_seed
        c = _quantize(seed - coarse_step, fine_step)
        while c >= min_c:
            r = _eval(c)
            if r is not None:
                if r[0] >= 0:
                    lo_c, lo_s = c, r[0]
                    break
                hi_c, hi_s = c, r[0]
            c = _quantize(c - coarse_step, fine_step)
        else:
            r = _eval(min_c)
            if r is not None and r[0] >= 0:
                lo_c, lo_s = min_c, r[0]

    if lo_c is None or hi_c is None:
        return _best_result()

    # --- Phase 3: Bisect within bracket ---
    for _ in range(10):
        if hi_c - lo_c <= fine_step:
            break
        # Linear interpolation to estimate zero crossing.
        if lo_s != hi_s:
            mid = lo_c + (hi_c - lo_c) * lo_s / (lo_s - hi_s)
            mid = _quantize(mid, fine_step)
            mid = max(lo_c + fine_step, min(hi_c - fine_step, mid))
        else:
            mid = _quantize((lo_c + hi_c) / 2, fine_step)

        r = _eval(mid)
        if r is None:
            break
        if r[0] > 0:
            lo_c, lo_s = mid, r[0]
        else:
            hi_c, hi_s = mid, r[0]

    return _best_result()


def export_stage_split_per_test_report(
    *,
    repo: TestFileRepository,
    analyzer: TemperatureAnalyzer,
    processing: TemperatureProcessingService,
    bias: TemperatureBaselineBiasService,
    plate_type: str,
    mode: str = "scalar",
    status_cb: Callable[[dict], None] | None = None,
) -> Dict[str, object]:
    """
    For each non-baseline test in a plate type, find best unified coef by MAE separately for:
      - BW stage (uses body_weight_n from meta)
      - DB stage (still uses body_weight_n for thresholds, but stage itself is 'db')

    Outputs a single CSV (one row per raw test) for offline inspection.
    """
    pt = str(plate_type or "").strip()
    if not pt:
        return {"ok": False, "message": "Missing plate type", "errors": ["Missing plate type"], "csv_path": None}

    devices = [d for d in (repo.list_temperature_devices() or []) if _plate_type_from_device_id(d) == pt]
    if not devices:
        return {"ok": False, "message": f"No devices found for plate type {pt}", "errors": [], "csv_path": None}

    out_dir = os.path.join(data_dir("analysis"), "temp_coef_stage_split_reports")
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, f"type{pt}-stage-split.csv")
    # Remove older timestamped reports for this plate type.
    try:
        prefix = f"type{pt}-stage-split-"
        for name in os.listdir(out_dir):
            if not name.lower().endswith(".csv"):
                continue
            if name.startswith(prefix):
                try:
                    os.remove(os.path.join(out_dir, name))
                except Exception:
                    pass
    except Exception:
        pass

    tmin = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MIN_F", 71.0))
    tmax = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MAX_F", 79.0))

    # Cache signature: list of non-baseline tests included in the report.
    signature: List[dict] = []
    try:
        for device_id in devices:
            baseline_entries = repo.list_temperature_room_baseline_tests(device_id, min_temp_f=tmin, max_temp_f=tmax) or []
            baseline_csvs = {str(e.get("csv_path") or "") for e in baseline_entries if str(e.get("csv_path") or "")}
            tests = repo.list_temperature_tests(device_id)
            for raw_csv in tests:
                if raw_csv in baseline_csvs:
                    continue
                meta = repo.load_temperature_meta_for_csv(raw_csv)
                if not meta:
                    continue
                signature.append(
                    {
                        "device_id": str(device_id),
                        "raw_csv": os.path.basename(raw_csv),
                        "mode": str(mode or "scalar"),
                    }
                )
        signature = sorted(signature, key=lambda r: (r.get("device_id") or "", r.get("raw_csv") or "", r.get("mode") or ""))
    except Exception:
        signature = []

    # Fast-path is handled by the unified_k cache loader (called by the controller/panel).

    eval_cache: dict = {}
    rows: List[Dict[str, object]] = []
    eval_entries: List[Dict[str, object]] = []
    errors: List[str] = []
    dumbbell_weight_n = float(getattr(config, "STABILIZER_45LB_WEIGHT_N", 206.3))

    # Pre-count non-baseline tests per device for progress reporting.
    _device_tests: List[Tuple[str, List[str]]] = []
    for device_id in devices:
        _bl_entries = repo.list_temperature_room_baseline_tests(device_id, min_temp_f=tmin, max_temp_f=tmax) or []
        _bl_csvs = {str(e.get("csv_path") or "") for e in _bl_entries if str(e.get("csv_path") or "")}
        _all_tests = repo.list_temperature_tests(device_id)
        _non_bl = [t for t in _all_tests if t not in _bl_csvs]
        if _non_bl:
            _device_tests.append((device_id, _non_bl))

    for di, (device_id, non_baseline_tests) in enumerate(_device_tests):
        if status_cb is not None:
            try:
                status_cb({
                    "status": "running",
                    "message": f"Stage-split MAE: device {di+1}/{len(_device_tests)} {device_id}",
                    "progress": 1,
                    "device_index": di,
                    "device_total": len(_device_tests),
                    "test_index": 0,
                    "test_total": len(non_baseline_tests),
                })
            except Exception:
                pass

        bias_res = bias.compute_and_store_bias_for_device(device_id=device_id, status_cb=status_cb)
        if not bool((bias_res or {}).get("ok")):
            errors.append(f"{device_id}: bias compute failed")
            continue

        bias_cache = repo.load_temperature_bias_cache(device_id) or {}
        bias_map = (bias_cache.get("bias_all") or bias_cache.get("bias")) if isinstance(bias_cache, dict) else None
        if not isinstance(bias_map, list):
            errors.append(f"{device_id}: bias cache missing bias map")
            continue

        for ti, raw_csv in enumerate(non_baseline_tests):
            meta = repo.load_temperature_meta_for_csv(raw_csv)
            if not meta:
                continue

            temp_f = None
            try:
                temp_f = repo.extract_temperature_f(meta)
            except Exception:
                temp_f = None

            body_weight_n = None
            try:
                body_weight_n = float((meta or {}).get("body_weight_n"))
            except Exception:
                body_weight_n = None

            try:
                bw_best = _best_unified_coef_for_test_stage_mae(
                    repo=repo,
                    analyzer=analyzer,
                    processing=processing,
                    device_id=device_id,
                    raw_csv=raw_csv,
                    meta=meta,
                    bias_map=bias_map,
                    stage_key="bw",
                    mode=str(mode or "scalar"),
                    status_cb=status_cb,
                    eval_cache=eval_cache,
                )
                db_best = _best_unified_coef_for_test_stage_mae(
                    repo=repo,
                    analyzer=analyzer,
                    processing=processing,
                    device_id=device_id,
                    raw_csv=raw_csv,
                    meta=meta,
                    bias_map=bias_map,
                    stage_key="db",
                    mode=str(mode or "scalar"),
                    status_cb=status_cb,
                    eval_cache=eval_cache,
                )
            except Exception as exc:
                errors.append(f"{device_id}: {os.path.basename(raw_csv)}: search failed: {exc}")
                continue

            rows.append(
                {
                    "plate_type": pt,
                    "device_id": device_id,
                    "raw_csv": os.path.basename(raw_csv),
                    "temp_f": temp_f,
                    "body_weight_n": body_weight_n,
                    "best_bw_coef": bw_best.get("best_coef"),
                    "bw_mean_abs": bw_best.get("best_mean_abs"),
                    "dumbbell_weight_n": dumbbell_weight_n,
                    "best_db_coef": db_best.get("best_coef"),
                    "db_mean_abs": db_best.get("best_mean_abs"),
                }
            )
            if status_cb is not None:
                try:
                    status_cb({
                        "status": "running",
                        "message": f"{device_id}: {ti+1}/{len(non_baseline_tests)} tests",
                        "device_index": di,
                        "device_total": len(_device_tests),
                        "test_index": ti + 1,
                        "test_total": len(non_baseline_tests),
                    })
                except Exception:
                    pass

            eval_entries.append(
                {
                    "device_id": device_id,
                    "raw_csv": raw_csv,
                    "meta": meta,
                    "bias_map": bias_map,
                }
            )

    summary: Optional[Dict[str, object]] = None
    ck = compute_c_and_k_from_stage_split_rows(rows, fref_n=float(getattr(config, "TEMP_POST_CORRECTION_FREF_N", 550.0)))
    if ck is not None:
        c_mean, k_val = ck
        bias_metrics = evaluate_unified_k_bias_metrics(
            repo=repo,
            analyzer=analyzer,
            processing=processing,
            plate_type=pt,
            eval_entries=eval_entries,
            c=float(c_mean),
            k=float(k_val),
            status_cb=status_cb,
        )
        if isinstance(bias_metrics, dict):
            summary = {
                "coef": float(c_mean),
                "coef_key": _coef_key(mode, float(c_mean)),
                "k": float(k_val),
                "mean_abs": bias_metrics.get("mean_abs"),
                "mean_signed": bias_metrics.get("mean_signed"),
                "std_signed": bias_metrics.get("std_signed"),
                "n": bias_metrics.get("n"),
                "bias": dict(bias_metrics),
            }

    # Write CSV
    cols = [
        "plate_type",
        "device_id",
        "raw_csv",
        "temp_f",
        "body_weight_n",
        "best_bw_coef",
        "bw_mean_abs",
        "dumbbell_weight_n",
        "best_db_coef",
        "db_mean_abs",
    ]
    try:
        with open(csv_path, "w", newline="", encoding="utf-8") as h:
            w = csv.DictWriter(h, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k) for k in cols})
    except Exception as exc:
        return {"ok": False, "message": f"Failed to write CSV: {exc}", "errors": [str(exc)], "csv_path": None}

    msg = f"Stage-split MAE report exported: {csv_path}"

    # Persist cache for "only recompute when new data is added" behavior.
    save_cache(pt, signature=signature, rows=len(rows), errors=errors, summary=summary)

    if status_cb is not None:
        try:
            status_cb({"status": "running", "message": msg, "progress": 100})
        except Exception:
            pass

    return {"ok": True, "message": msg, "csv_path": csv_path, "rows": len(rows), "errors": errors, "summary": summary}
