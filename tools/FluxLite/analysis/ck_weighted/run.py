"""
C+K Weighted Regression
========================
Single weighted regression to derive c and k simultaneously.

Each test-stage is one data point with:
  - exact deltaT and force (no force bucketing)
  - weight = 1 / (num tests in its 5F temp bucket) so no temp range dominates

Model: error_pct = beta1 * deltaT + beta2 * deltaT * (F - Fref) / Fref
  => c = -beta1 / 100,  k = -beta2 / 100

Outputs (in output/):
  - regression_results.txt
  - data.csv                            -- all test-stage data points with weights
  - before_after_ck.png / _excl_25.png  -- 3-panel: no correction / after c / after c+k
  - fit_quality.png / _excl_25.png      -- predicted vs actual error
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

OUT = ensure_output_dir(__file__)
PLATE_TYPE = "06"
DAMAGED_DEVICE = "06.00000025"
IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
FREF = float(getattr(config, "TEMP_POST_CORRECTION_FREF_N", 550.0))
BUCKET_SIZE = 5.0

tmin = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MIN_F", 71.0))
tmax = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MAX_F", 77.0))

# --- Collect per-test-stage data ---
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices if d.startswith(PLATE_TYPE + ".")]
print(f"Plate type {PLATE_TYPE}: {len(pt_devices)} devices")

rows = []
for dev in pt_devices:
    bias_cache = repo.load_temperature_bias_cache(dev) or {}
    bias_map = (bias_cache.get("bias_all") or bias_cache.get("bias")) if isinstance(bias_cache, dict) else None
    if not isinstance(bias_map, list):
        continue

    baseline_entries = repo.list_temperature_room_baseline_tests(dev, min_temp_f=tmin, max_temp_f=tmax) or []
    bl_csvs = {str(e.get("csv_path") or "") for e in baseline_entries if str(e.get("csv_path") or "")}
    tests = repo.list_temperature_tests(dev)

    for raw_csv in tests:
        if raw_csv in bl_csvs:
            continue
        meta = repo.load_temperature_meta_for_csv(raw_csv)
        if not meta:
            continue
        temp_f = repo.extract_temperature_f(meta)
        if temp_f is None:
            continue

        details = repo.get_temperature_test_details(raw_csv)
        proc_runs = list((details or {}).get("processed_runs") or [])
        baseline_path = ""
        for r in proc_runs:
            if r.get("is_baseline") and not baseline_path:
                baseline_path = str(r.get("path") or "")

        if not (baseline_path and os.path.isfile(baseline_path)):
            processing.run_temperature_processing(
                folder=os.path.dirname(raw_csv),
                device_id=dev,
                csv_path=raw_csv,
                slopes={"x": 0.0, "y": 0.0, "z": 0.0},
                room_temp_f=IDEAL_TEMP_F,
                mode="scalar",
            )
            details = repo.get_temperature_test_details(raw_csv)
            proc_runs = list((details or {}).get("processed_runs") or [])
            baseline_path = ""
            for r in proc_runs:
                if r.get("is_baseline") and not baseline_path:
                    baseline_path = str(r.get("path") or "")

        if not (baseline_path and os.path.isfile(baseline_path)):
            continue

        single = analyzer.analyze_single_processed_csv(baseline_path, meta)
        data = single.get("data") or {}
        stages_data = data.get("stages") or {}
        delta_t = temp_f - IDEAL_TEMP_F

        for stage_key in ("bw", "db"):
            stage = stages_data.get(stage_key, {})
            target_n = float(stage.get("target_n") or 0.0)
            if target_n <= 0:
                continue
            cells = stage.get("cells") or []
            if not cells:
                continue

            signed_errors = []
            for cell in cells:
                row_idx = int(cell.get("row", 0))
                col_idx = int(cell.get("col", 0))
                mean_n = float(cell.get("mean_n", 0.0))
                try:
                    cell_bias = float(bias_map[row_idx][col_idx])
                except Exception:
                    cell_bias = 0.0
                adjusted_target = target_n * (1.0 + cell_bias)
                if adjusted_target <= 0:
                    continue
                signed_errors.append((mean_n - adjusted_target) / adjusted_target * 100.0)

            if not signed_errors:
                continue

            rows.append({
                "device_id": dev,
                "raw_csv": os.path.basename(raw_csv),
                "temp_f": temp_f,
                "delta_t": delta_t,
                "stage": stage_key,
                "force_n": target_n,
                "n_cells": len(signed_errors),
                "avg_signed_pct": sum(signed_errors) / len(signed_errors),
                "is_damaged": dev == DAMAGED_DEVICE,
            })

df = pd.DataFrame(rows)
print(f"{len(df)} test-stage data points")


def run_analysis(sdf, label, suffix):
    lines = []
    lines.append(f"{'='*60}")
    lines.append(f"  {label}")
    lines.append(f"{'='*60}")
    lines.append(f"  {len(sdf)} test-stage points")

    sdf = sdf.copy()

    # --- Compute temp-bucket weights ---
    sdf["temp_bucket"] = (sdf["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bucket_counts = sdf.groupby("temp_bucket").size().to_dict()
    sdf["weight"] = sdf["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])

    lines.append(f"")
    lines.append(f"  Temp buckets ({BUCKET_SIZE:.0f}F):")
    for bucket in sorted(bucket_counts.keys()):
        n = bucket_counts[bucket]
        bucket_data = sdf[sdf["temp_bucket"] == bucket]
        avg_err = bucket_data["avg_signed_pct"].mean()
        lines.append(f"    {bucket:+6.1f}F: n={n:2d}, avg_err={avg_err:+.2f}%, weight={1.0/n:.3f}")

    # --- Weighted regression: error = b1*deltaT + b2*deltaT*(F-Fref)/Fref ---
    delta_t = sdf["delta_t"].values.astype(float)
    force = sdf["force_n"].values.astype(float)
    y = sdf["avg_signed_pct"].values.astype(float)
    w = sdf["weight"].values.astype(float)

    X1 = delta_t
    X2 = delta_t * (force - FREF) / FREF
    X = np.column_stack([X1, X2])

    # Apply weights: multiply rows by sqrt(w)
    sw = np.sqrt(w)
    Xw = X * sw[:, None]
    yw = y * sw

    beta = np.linalg.lstsq(Xw, yw, rcond=None)[0]
    c_val = -beta[0] / 100.0
    k_val = -beta[1] / 100.0

    # Also fit c-only (weighted)
    beta_c_only = np.linalg.lstsq((X1 * sw).reshape(-1, 1), yw, rcond=None)[0]
    c_only = -beta_c_only[0] / 100.0

    # R2 (weighted)
    y_pred = X @ beta
    y_pred_c_only = X1 * (-c_only * 100.0)
    ss_res = np.sum(w * (y - y_pred) ** 2)
    ss_res_c = np.sum(w * (y - y_pred_c_only) ** 2)
    ss_tot = np.sum(w * (y - np.average(y, weights=w)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    r2_c_only = 1.0 - ss_res_c / ss_tot if ss_tot > 0 else 0.0

    lines.append(f"")
    lines.append(f"  C+K model (weighted):")
    lines.append(f"    c = {c_val:.6f}")
    lines.append(f"    k = {k_val:.6f}")
    lines.append(f"    R2 = {r2:.4f}")
    lines.append(f"")
    lines.append(f"  C-only model (weighted):")
    lines.append(f"    c = {c_only:.6f}")
    lines.append(f"    R2 = {r2_c_only:.4f}")
    lines.append(f"")
    lines.append(f"  R2 improvement from k: {r2 - r2_c_only:+.4f}")

    # --- Apply corrections ---
    sdf["error_after_c"] = sdf["avg_signed_pct"] + delta_t * c_val * 100.0
    sdf["fz_after_c"] = sdf["force_n"] * (1.0 + delta_t * c_val) / (1.0)  # approximate
    sdf["error_after_ck"] = y - y_pred  # residual = actual - predicted, which is the post-correction error

    # More accurate: simulate both corrections
    # after_c: the correction removes deltaT * c from the fractional error
    # after_ck: removes deltaT * (c + k*(F-Fref)/Fref)
    sdf["corrected_error_c"] = y + delta_t * c_val * 100.0
    sdf["corrected_error_ck"] = y + (delta_t * c_val + delta_t * k_val * (force - FREF) / FREF) * 100.0

    mean_abs_before = sdf["avg_signed_pct"].abs().mean()
    mean_abs_c = sdf["corrected_error_c"].abs().mean()
    mean_abs_ck = sdf["corrected_error_ck"].abs().mean()

    lines.append(f"")
    lines.append(f"  Mean |error|:")
    lines.append(f"    No correction:  {mean_abs_before:.2f}%")
    lines.append(f"    After c:        {mean_abs_c:.2f}%")
    lines.append(f"    After c+k:      {mean_abs_ck:.2f}%")
    lines.append(f"{'='*60}")

    report = "\n".join(lines)
    print(report)

    # --- Save data ---
    sdf.to_csv(os.path.join(OUT, f"data{suffix}.csv"), index=False)

    # --- Plot: 3-panel before / after c / after c+k ---
    # Bucket for plotting only (data points are per-test-stage, bucketed by temp)
    sdf["temp_bucket_f"] = sdf["temp_bucket"] + IDEAL_TEMP_F

    force_bands = [
        ("DB ~200N", 100, 300, "tab:orange", "^"),
        ("BW 600-750N", 500, 750, "tab:green", "o"),
        ("BW 750-950N", 750, 950, "tab:blue", "s"),
        ("BW 950-1100N", 950, 1200, "tab:red", "D"),
    ]

    # Bucket-average for clean plotting
    plot_rows = []
    for band_label, flo, fhi, color, marker in force_bands:
        band = sdf[(sdf["force_n"] >= flo) & (sdf["force_n"] < fhi)]
        if band.empty:
            continue
        for bucket, grp in band.groupby("temp_bucket_f"):
            plot_rows.append({
                "band": band_label, "color": color, "marker": marker,
                "temp_bucket": bucket, "n": len(grp),
                "avg_uncorrected": grp["avg_signed_pct"].mean(),
                "avg_after_c": grp["corrected_error_c"].mean(),
                "avg_after_ck": grp["corrected_error_ck"].mean(),
            })
    plot_df = pd.DataFrame(plot_rows)

    fig, axes = plt.subplots(1, 3, figsize=(18, 6), sharey=True)
    for ax, col, title in [
        (axes[0], "avg_uncorrected", "No correction"),
        (axes[1], "avg_after_c", f"After c = {c_val:.5f}"),
        (axes[2], "avg_after_ck", f"After c={c_val:.5f} + k={k_val:.6f}"),
    ]:
        for band_label, flo, fhi, color, marker in force_bands:
            pts = plot_df[plot_df["band"] == band_label]
            if pts.empty:
                continue
            ax.scatter(pts["temp_bucket"], pts[col], c=color, marker=marker,
                       s=80, alpha=0.8, label=band_label, edgecolors="black", linewidths=0.5)
            if len(pts) >= 2:
                x = pts["temp_bucket"].values.astype(float)
                y_vals = pts[col].values.astype(float)
                z = np.polyfit(x, y_vals, 1)
                x_line = np.linspace(x.min(), x.max(), 50)
                ax.plot(x_line, np.polyval(z, x_line), color=color, ls="--", lw=1.5, alpha=0.5)

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel(f"Temperature (F) -- {BUCKET_SIZE:.0f}F buckets")
        ax.set_ylabel("Avg signed error (%)")
        ax.set_title(title)
        ax.legend(fontsize=7)

    fig.suptitle(
        f"Type {PLATE_TYPE} -- {label}\n"
        f"Mean |error|: {mean_abs_before:.2f}% -> c: {mean_abs_c:.2f}% -> c+k: {mean_abs_ck:.2f}%",
        fontsize=12,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, f"before_after_ck{suffix}.png"))
    print(f"Saved before_after_ck{suffix}.png")
    plt.close(fig)

    # --- Plot: predicted vs actual (fit quality) ---
    fig, ax = plt.subplots(figsize=(8, 8))
    for band_label, flo, fhi, color, marker in force_bands:
        band = sdf[(sdf["force_n"] >= flo) & (sdf["force_n"] < fhi)]
        if band.empty:
            continue
        pred = -(band["delta_t"] * c_val + band["delta_t"] * k_val * (band["force_n"] - FREF) / FREF) * 100.0
        ax.scatter(band["avg_signed_pct"], pred, c=color, marker=marker,
                   s=50, alpha=0.7, label=band_label)

    lo = min(sdf["avg_signed_pct"].min(), -5)
    hi = max(sdf["avg_signed_pct"].max(), 5)
    ax.plot([lo, hi], [lo, hi], "r--", lw=1, label="perfect fit")
    ax.set_xlabel("Actual error (%)")
    ax.set_ylabel("Predicted error (%)")
    ax.set_title(f"Type {PLATE_TYPE} -- {label}\nWeighted regression fit quality")
    ax.legend(fontsize=8)
    ax.set_aspect("equal")
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, f"fit_quality{suffix}.png"))
    print(f"Saved fit_quality{suffix}.png")
    plt.close(fig)

    return report, c_val, k_val


# --- Run both variants ---
reports = []

r_all, c_all, k_all = run_analysis(df, "All plates", "")
reports.append(r_all)

df_clean = df[~df["is_damaged"]].copy()
r_clean, c_clean, k_clean = run_analysis(df_clean, f"Excluding {DAMAGED_DEVICE}", "_excl_25")
reports.append(r_clean)

with open(os.path.join(OUT, "regression_results.txt"), "w") as f:
    f.write("\n\n".join(reports))
print(f"\nSaved regression_results.txt")

print("\nDone. Check output/ for results.")
