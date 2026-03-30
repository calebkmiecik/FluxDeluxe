"""
C+K Regression (corrected)
===========================
Two-stage analytical derivation matching how c and k are actually applied:

Stage 1 (c): corrected = raw * (1 + deltaT * c)
  - Fit c from test-averaged processed-off error vs deltaT

Stage 2 (k): final = after_c * (1 + deltaT * k * ((|Fz| - Fref) / Fref))
  - Applied per-cell based on cell force magnitude
  - Fit k from cell-level residual error after c

Outputs (in output/):
  - regression_results.txt
  - before_after.png / _excl_25.png        -- test-level before/after c
  - k_fit.png / _excl_25.png               -- cell-level residual vs k predictor
  - before_after_ck.png / _excl_25.png     -- test-level before/after c+k
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

tmin = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MIN_F", 71.0))
tmax = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MAX_F", 77.0))

# --- Collect per-CELL data from processed-off files ---
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices if d.startswith(PLATE_TYPE + ".")]
print(f"Plate type {PLATE_TYPE}: {len(pt_devices)} devices")

cell_rows = []
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

                signed_pct = (mean_n - adjusted_target) / adjusted_target * 100.0

                cell_rows.append({
                    "device_id": dev,
                    "raw_csv": os.path.basename(raw_csv),
                    "temp_f": temp_f,
                    "delta_t": delta_t,
                    "stage": stage_key,
                    "row": row_idx,
                    "col": col_idx,
                    "cell_fz": mean_n,
                    "target_n": adjusted_target,
                    "signed_pct": signed_pct,
                    "is_damaged": dev == DAMAGED_DEVICE,
                })

df = pd.DataFrame(cell_rows)
print(f"{len(df)} cell-level data points")


def run_analysis(cdf, label, suffix):
    lines = []
    lines.append(f"{'='*60}")
    lines.append(f"  {label}")
    lines.append(f"{'='*60}")
    lines.append(f"  {len(cdf)} cells across {cdf['raw_csv'].nunique()} tests")

    # --- Stage 1: Fit c from temp-bucketed error ---
    # Bucket temps into 5-degree bins so dense temp ranges don't dominate
    BUCKET_SIZE = 5.0
    test_avg = cdf.groupby(["device_id", "raw_csv", "delta_t"]).agg(
        avg_signed_pct=("signed_pct", "mean"),
    ).reset_index()
    test_avg["temp_bucket"] = (test_avg["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE

    bucketed = test_avg.groupby("temp_bucket").agg(
        avg_signed_pct=("avg_signed_pct", "mean"),
        n_tests=("avg_signed_pct", "count"),
    ).reset_index()
    bucketed["delta_t"] = bucketed["temp_bucket"]

    dt_bucketed = bucketed["delta_t"].values.astype(float)
    y_bucketed = bucketed["avg_signed_pct"].values.astype(float)

    # Also fit unbucketed for comparison
    dt_all = test_avg["delta_t"].values.astype(float)
    y_all = test_avg["avg_signed_pct"].values.astype(float)
    c_raw_unbucketed = np.linalg.lstsq(dt_all.reshape(-1, 1), y_all, rcond=None)[0][0]

    # c_fit on bucketed data: avg_error = delta_t * c * 100  (no intercept)
    c_raw = np.linalg.lstsq(dt_bucketed.reshape(-1, 1), y_bucketed, rcond=None)[0][0]
    c_val = c_raw / 100.0
    c_correction = abs(c_val)

    y_pred_c = dt_bucketed * c_raw
    ss_res_c = np.sum((y_bucketed - y_pred_c) ** 2)
    ss_tot = np.sum((y_bucketed - np.mean(y_bucketed)) ** 2)
    r2_c = 1.0 - ss_res_c / ss_tot if ss_tot > 0 else 0.0

    c_unbucketed = abs(c_raw_unbucketed / 100.0)

    lines.append(f"")
    lines.append(f"  Stage 1 -- Fit c ({len(bucketed)} temp buckets of {BUCKET_SIZE}F):")
    lines.append(f"    c (bucketed)   = {c_correction:.6f}")
    lines.append(f"    c (unbucketed) = {c_unbucketed:.6f}")
    lines.append(f"    R2 (bucketed)  = {r2_c:.4f}")
    for _, row in bucketed.iterrows():
        lines.append(f"      bucket {row['delta_t']:+6.1f}F: avg_err={row['avg_signed_pct']:+.2f}%, n={int(row['n_tests'])}")

    # --- Stage 2: Apply c per-cell, fit k from residual ---
    cdf = cdf.copy()
    # Simulate c correction: after_c = cell_fz * (1 + delta_t * c_correction)
    # (c_correction is positive; when cold delta_t<0, this scales down the too-high reading)
    cdf["fz_after_c"] = cdf["cell_fz"] * (1.0 + cdf["delta_t"] * c_correction)
    cdf["error_after_c_pct"] = (cdf["fz_after_c"] - cdf["target_n"]) / cdf["target_n"] * 100.0

    # k predictor per cell: delta_t * (|fz_after_c| - Fref) / Fref
    # k correction: final = fz_after_c * (1 + delta_t * k * ((|fz| - Fref)/Fref))
    # Residual error after c ≈ delta_t * k * ((|fz| - Fref)/Fref) * 100
    cdf["k_predictor"] = cdf["delta_t"] * (cdf["fz_after_c"].abs() - FREF) / FREF

    # Bucket k predictor to avoid temp-dense ranges dominating k fit
    # Group cells by test+stage, then bucket by temp
    cell_stage_avg = cdf.groupby(["device_id", "raw_csv", "stage", "delta_t"]).agg(
        k_predictor=("k_predictor", "mean"),
        error_after_c_pct=("error_after_c_pct", "mean"),
    ).reset_index()
    cell_stage_avg["temp_bucket"] = (cell_stage_avg["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE

    k_bucketed = cell_stage_avg.groupby(["temp_bucket", "stage"]).agg(
        k_predictor=("k_predictor", "mean"),
        error_after_c_pct=("error_after_c_pct", "mean"),
    ).reset_index()

    k_x = k_bucketed["k_predictor"].values.astype(float)
    k_y = k_bucketed["error_after_c_pct"].values.astype(float)

    k_raw = np.linalg.lstsq(k_x.reshape(-1, 1), k_y, rcond=None)[0][0]
    k_val = -k_raw / 100.0  # negative: k must oppose the residual error, not match it

    k_pred = k_x * k_raw
    ss_res_k = np.sum((k_y - k_pred) ** 2)
    ss_tot_k = np.sum((k_y - np.mean(k_y)) ** 2)
    r2_k = 1.0 - ss_res_k / ss_tot_k if ss_tot_k > 0 else 0.0

    # Also apply k to get final corrected values
    cdf["fz_after_ck"] = cdf["fz_after_c"] * (1.0 + cdf["delta_t"] * k_val * ((cdf["fz_after_c"].abs() - FREF) / FREF))
    cdf["error_after_ck_pct"] = (cdf["fz_after_ck"] - cdf["target_n"]) / cdf["target_n"] * 100.0

    lines.append(f"")
    lines.append(f"  Stage 2 -- Fit k (cell-level residual after c):")
    lines.append(f"    k = {k_val:.6f}")
    lines.append(f"    R2 of k fit = {r2_k:.4f}")

    # Test+stage level summaries (keep BW and DB separate)
    test_summary = cdf.groupby(["device_id", "raw_csv", "temp_f", "delta_t", "stage"]).agg(
        force_n=("target_n", "mean"),
        avg_uncorrected=("signed_pct", "mean"),
        avg_after_c=("error_after_c_pct", "mean"),
        avg_after_ck=("error_after_ck_pct", "mean"),
        abs_uncorrected=("signed_pct", lambda x: x.abs().mean()),
        abs_after_c=("error_after_c_pct", lambda x: x.abs().mean()),
        abs_after_ck=("error_after_ck_pct", lambda x: x.abs().mean()),
    ).reset_index()

    # Bucket into 5-degree temp bins per force band for plotting
    test_summary["temp_bucket"] = (test_summary["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE + IDEAL_TEMP_F

    force_bands = [
        ("DB ~200N", 100, 300, "tab:orange", "^"),
        ("BW 600-750N", 500, 750, "tab:green", "o"),
        ("BW 750-950N", 750, 950, "tab:blue", "s"),
        ("BW 950-1100N", 950, 1200, "tab:red", "D"),
    ]

    # Build bucketed plot data: average per (temp_bucket, force_band)
    plot_rows = []
    for band_label, flo, fhi, color, marker in force_bands:
        band = test_summary[(test_summary["force_n"] >= flo) & (test_summary["force_n"] < fhi)]
        if band.empty:
            continue
        for bucket, grp in band.groupby("temp_bucket"):
            plot_rows.append({
                "band": band_label,
                "color": color,
                "marker": marker,
                "temp_bucket": bucket,
                "n": len(grp),
                "avg_uncorrected": grp["avg_uncorrected"].mean(),
                "avg_after_c": grp["avg_after_c"].mean(),
                "avg_after_ck": grp["avg_after_ck"].mean(),
                "abs_uncorrected": grp["abs_uncorrected"].mean(),
                "abs_after_c": grp["abs_after_c"].mean(),
                "abs_after_ck": grp["abs_after_ck"].mean(),
            })
    plot_df = pd.DataFrame(plot_rows)

    mean_abs_before = test_summary["abs_uncorrected"].mean()
    mean_abs_after_c = test_summary["abs_after_c"].mean()
    mean_abs_after_ck = test_summary["abs_after_ck"].mean()

    lines.append(f"")
    lines.append(f"  Mean |error| per test:")
    lines.append(f"    No correction:  {mean_abs_before:.2f}%")
    lines.append(f"    After c:        {mean_abs_after_c:.2f}%")
    lines.append(f"    After c+k:      {mean_abs_after_ck:.2f}%")
    lines.append(f"{'='*60}")

    report = "\n".join(lines)
    print(report)

    # --- Plot: before / after c / after c+k (bucketed) ---
    fig, axes = plt.subplots(1, 3, figsize=(18, 6), sharey=True)

    for ax, col, title in [
        (axes[0], "avg_uncorrected", "No correction"),
        (axes[1], "avg_after_c", f"After c = {c_correction:.5f}"),
        (axes[2], "avg_after_ck", f"After c + k = {k_val:.6f}"),
    ]:
        for band_label, flo, fhi, color, marker in force_bands:
            band_pts = plot_df[plot_df["band"] == band_label]
            if band_pts.empty:
                continue
            ax.scatter(band_pts["temp_bucket"], band_pts[col], c=color, marker=marker,
                       s=80, alpha=0.8, label=band_label, edgecolors="black", linewidths=0.5)
            if len(band_pts) >= 2:
                x = band_pts["temp_bucket"].values.astype(float)
                y = band_pts[col].values.astype(float)
                z = np.polyfit(x, y, 1)
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
        f"Mean |error|: {mean_abs_before:.2f}% -> c: {mean_abs_after_c:.2f}% -> c+k: {mean_abs_after_ck:.2f}%",
        fontsize=12,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, f"before_after_ck{suffix}.png"))
    print(f"Saved before_after_ck{suffix}.png")
    plt.close(fig)

    # --- Plot: k fit (cell-level residual after c vs k_predictor) ---
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.scatter(cdf["k_predictor"], cdf["error_after_c_pct"], s=10, alpha=0.3, c="tab:blue")

    # Fit line
    x_range = np.linspace(cdf["k_predictor"].min(), cdf["k_predictor"].max(), 50)
    ax.plot(x_range, x_range * k_raw, "r-", lw=2, label=f"k = {k_val:.6f}")
    ax.axhline(0, color="gray", ls=":", lw=0.8)
    ax.axvline(0, color="gray", ls=":", lw=0.8)
    ax.set_xlabel("k predictor: deltaT * (|Fz| - Fref) / Fref")
    ax.set_ylabel("Residual error after c (%)")
    ax.set_title(f"Type {PLATE_TYPE} -- {label}\nk fit: residual after c vs force-temp predictor")
    ax.legend()
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, f"k_fit{suffix}.png"))
    print(f"Saved k_fit{suffix}.png")
    plt.close(fig)

    return report, c_correction, k_val


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
