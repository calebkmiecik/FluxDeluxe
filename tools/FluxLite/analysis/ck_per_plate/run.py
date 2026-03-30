"""
C+K Per-Plate Weighted Regression
==================================
Derives c and k independently for each plate, then averages across plates
of the same type.

Key differences from ck_weighted:
  - No bias correction: uses raw target_n directly. Per-plate fitting means
    manufacturing bias is baked into the intercept, not the slope.
  - No baseline exclusion: all tests included (including room-temp ones).
    Temperature-bucket weighting already prevents room-temp tests from
    dominating.
  - Per-plate regression: each plate gets its own c and k, then we average.
    This naturally handles plates with different temp sensors.

Model (same as approach 4):
  error_pct = beta1 * deltaT + beta2 * deltaT * (F - Fref) / Fref
  => c = -beta1 / 100,  k = -beta2 / 100

Outputs (in output/):
  - regression_results.txt          -- per-plate and averaged results
  - data.csv                        -- all test-stage data points
  - per_plate_coefficients.csv      -- c and k per plate
  - per_plate_panels.png            -- per-plate before/after correction
  - averaged_summary.png            -- averaged correction across all plates
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


# ---------------------------------------------------------------------------
# 1. Collect per-test-stage data (no bias correction, no baseline exclusion)
# ---------------------------------------------------------------------------
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices if d.startswith(PLATE_TYPE + ".")]
print(f"Plate type {PLATE_TYPE}: {len(pt_devices)} devices")

rows = []
for dev in pt_devices:
    tests = repo.list_temperature_tests(dev)

    for raw_csv in tests:
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
            # Try processing; skip if still missing
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

            # No bias correction -- use target_n directly
            signed_errors = []
            for cell in cells:
                mean_n = float(cell.get("mean_n", 0.0))
                if target_n <= 0:
                    continue
                signed_errors.append((mean_n - target_n) / target_n * 100.0)

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
print(f"{len(df)} total test-stage data points across {len(pt_devices)} devices")


# ---------------------------------------------------------------------------
# 2. Per-plate weighted regression
# ---------------------------------------------------------------------------
def fit_plate(plate_df, device_id):
    """Run weighted regression for a single plate. Returns dict with results."""
    plate_df = plate_df.copy()
    n_points = len(plate_df)

    if n_points < 3:
        print(f"  {device_id}: only {n_points} points, skipping regression")
        return None

    # Temperature-bucket weights
    plate_df["temp_bucket"] = (plate_df["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bucket_counts = plate_df.groupby("temp_bucket").size().to_dict()
    plate_df["weight"] = plate_df["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])

    delta_t = plate_df["delta_t"].values.astype(float)
    force = plate_df["force_n"].values.astype(float)
    y = plate_df["avg_signed_pct"].values.astype(float)
    w = plate_df["weight"].values.astype(float)

    # C+K model
    X1 = delta_t
    X2 = delta_t * (force - FREF) / FREF
    X = np.column_stack([X1, X2])

    sw = np.sqrt(w)
    Xw = X * sw[:, None]
    yw = y * sw

    beta = np.linalg.lstsq(Xw, yw, rcond=None)[0]
    c_val = -beta[0] / 100.0
    k_val = -beta[1] / 100.0

    # C-only model
    beta_c_only = np.linalg.lstsq((X1 * sw).reshape(-1, 1), yw, rcond=None)[0]
    c_only = -beta_c_only[0] / 100.0

    # Weighted R2
    y_pred = X @ beta
    y_pred_c_only = X1 * (-c_only * 100.0)
    ss_res = np.sum(w * (y - y_pred) ** 2)
    ss_res_c = np.sum(w * (y - y_pred_c_only) ** 2)
    ss_tot = np.sum(w * (y - np.average(y, weights=w)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    r2_c_only = 1.0 - ss_res_c / ss_tot if ss_tot > 0 else 0.0

    # Correction metrics
    corrected_c = y + delta_t * c_val * 100.0
    corrected_ck = y + (delta_t * c_val + delta_t * k_val * (force - FREF) / FREF) * 100.0

    mean_abs_before = np.mean(np.abs(y))
    mean_abs_c = np.mean(np.abs(corrected_c))
    mean_abs_ck = np.mean(np.abs(corrected_ck))

    # Temperature spread
    temp_range = plate_df["temp_f"].max() - plate_df["temp_f"].min()
    n_buckets = len(bucket_counts)

    return {
        "device_id": device_id,
        "n_points": n_points,
        "n_buckets": n_buckets,
        "temp_min_f": plate_df["temp_f"].min(),
        "temp_max_f": plate_df["temp_f"].max(),
        "temp_range_f": temp_range,
        "c": c_val,
        "k": k_val,
        "c_only": c_only,
        "r2_ck": r2,
        "r2_c_only": r2_c_only,
        "mean_abs_before": mean_abs_before,
        "mean_abs_after_c": mean_abs_c,
        "mean_abs_after_ck": mean_abs_ck,
        "bucket_counts": bucket_counts,
    }


# Run per-plate
plate_results = []
for dev in sorted(pt_devices):
    plate_df = df[df["device_id"] == dev]
    print(f"\n--- {dev} ({len(plate_df)} points) ---")
    result = fit_plate(plate_df, dev)
    if result:
        plate_results.append(result)
        print(f"  c = {result['c']:.6f}, k = {result['k']:.6f}, "
              f"R2 = {result['r2_ck']:.4f}, "
              f"temp range = {result['temp_min_f']:.1f}-{result['temp_max_f']:.1f}F")

# Also run excluding damaged device
clean_results = [r for r in plate_results if r["device_id"] != DAMAGED_DEVICE]


# ---------------------------------------------------------------------------
# 3. Average across plates
# ---------------------------------------------------------------------------
def summarize(results, label):
    lines = []
    lines.append(f"{'='*60}")
    lines.append(f"  {label}")
    lines.append(f"{'='*60}")

    if not results:
        lines.append("  No plates with enough data.")
        return "\n".join(lines), None

    lines.append(f"  {len(results)} plates")
    lines.append("")

    for r in results:
        lines.append(f"  {r['device_id']}:")
        lines.append(f"    n={r['n_points']}, temp={r['temp_min_f']:.0f}-{r['temp_max_f']:.0f}F "
                      f"({r['n_buckets']} buckets, range={r['temp_range_f']:.0f}F)")
        lines.append(f"    c = {r['c']:.6f}, k = {r['k']:.6f}")
        lines.append(f"    R2(c+k) = {r['r2_ck']:.4f}, R2(c-only) = {r['r2_c_only']:.4f}")
        lines.append(f"    |error|: {r['mean_abs_before']:.2f}% -> c: {r['mean_abs_after_c']:.2f}% "
                      f"-> c+k: {r['mean_abs_after_ck']:.2f}%")

    c_vals = np.array([r["c"] for r in results])
    k_vals = np.array([r["k"] for r in results])

    avg_c = np.mean(c_vals)
    avg_k = np.mean(k_vals)
    std_c = np.std(c_vals, ddof=1) if len(c_vals) > 1 else 0.0
    std_k = np.std(k_vals, ddof=1) if len(k_vals) > 1 else 0.0

    lines.append("")
    lines.append(f"  Averaged coefficients:")
    lines.append(f"    c = {avg_c:.6f}  (std = {std_c:.6f})")
    lines.append(f"    k = {avg_k:.6f}  (std = {std_k:.6f})")

    # Apply averaged c+k to all data to see overall improvement
    all_plate_devs = {r["device_id"] for r in results}
    subset = df[df["device_id"].isin(all_plate_devs)].copy()
    delta_t = subset["delta_t"].values.astype(float)
    force = subset["force_n"].values.astype(float)
    y = subset["avg_signed_pct"].values.astype(float)
    corrected_c = y + delta_t * avg_c * 100.0
    corrected_ck = y + (delta_t * avg_c + delta_t * avg_k * (force - FREF) / FREF) * 100.0

    lines.append("")
    lines.append(f"  Averaged correction applied to all {len(subset)} points:")
    lines.append(f"    |error|: {np.mean(np.abs(y)):.2f}% -> c: {np.mean(np.abs(corrected_c)):.2f}% "
                  f"-> c+k: {np.mean(np.abs(corrected_ck)):.2f}%")
    lines.append(f"{'='*60}")

    summary = {
        "avg_c": avg_c, "avg_k": avg_k,
        "std_c": std_c, "std_k": std_k,
        "mean_abs_before": np.mean(np.abs(y)),
        "mean_abs_after_c": np.mean(np.abs(corrected_c)),
        "mean_abs_after_ck": np.mean(np.abs(corrected_ck)),
    }
    return "\n".join(lines), summary


report_all, summary_all = summarize(plate_results, "All plates (per-plate averaged)")
report_clean, summary_clean = summarize(clean_results, f"Excluding {DAMAGED_DEVICE} (per-plate averaged)")

print("\n" + report_all)
print("\n" + report_clean)


# ---------------------------------------------------------------------------
# 4. Save results
# ---------------------------------------------------------------------------
# Per-plate coefficients CSV
coef_rows = []
for r in plate_results:
    coef_rows.append({
        "device_id": r["device_id"],
        "c": r["c"],
        "k": r["k"],
        "c_only": r["c_only"],
        "r2_ck": r["r2_ck"],
        "r2_c_only": r["r2_c_only"],
        "n_points": r["n_points"],
        "n_buckets": r["n_buckets"],
        "temp_range_f": r["temp_range_f"],
        "mean_abs_before": r["mean_abs_before"],
        "mean_abs_after_c": r["mean_abs_after_c"],
        "mean_abs_after_ck": r["mean_abs_after_ck"],
        "is_damaged": r["device_id"] == DAMAGED_DEVICE,
    })
pd.DataFrame(coef_rows).to_csv(os.path.join(OUT, "per_plate_coefficients.csv"), index=False)

# Full data
df.to_csv(os.path.join(OUT, "data.csv"), index=False)

# Report
with open(os.path.join(OUT, "regression_results.txt"), "w") as f:
    f.write(report_all + "\n\n" + report_clean)
print(f"\nSaved regression_results.txt, per_plate_coefficients.csv, data.csv")


# ---------------------------------------------------------------------------
# 5. Plot: per-plate before/after panels
# ---------------------------------------------------------------------------
force_bands = [
    ("DB ~200N", 100, 300, "tab:orange", "^"),
    ("BW 600-750N", 500, 750, "tab:green", "o"),
    ("BW 750-950N", 750, 950, "tab:blue", "s"),
    ("BW 950-1100N", 950, 1200, "tab:red", "D"),
]

n_plates = len(clean_results)
if n_plates > 0:
    fig, axes = plt.subplots(n_plates, 3, figsize=(18, 5 * n_plates), squeeze=False, sharey=True)

    for i, r in enumerate(clean_results):
        dev = r["device_id"]
        plate_df = df[df["device_id"] == dev].copy()
        c_val, k_val = r["c"], r["k"]

        delta_t = plate_df["delta_t"].values.astype(float)
        force = plate_df["force_n"].values.astype(float)
        y = plate_df["avg_signed_pct"].values.astype(float)

        plate_df["corrected_c"] = y + delta_t * c_val * 100.0
        plate_df["corrected_ck"] = y + (delta_t * c_val + delta_t * k_val * (force - FREF) / FREF) * 100.0

        for j, (col, title) in enumerate([
            ("avg_signed_pct", "No correction"),
            ("corrected_c", f"After c={c_val:.5f}"),
            ("corrected_ck", f"After c={c_val:.5f} k={k_val:.6f}"),
        ]):
            ax = axes[i][j]
            for band_label, flo, fhi, color, marker in force_bands:
                band = plate_df[(plate_df["force_n"] >= flo) & (plate_df["force_n"] < fhi)]
                if band.empty:
                    continue
                ax.scatter(band["temp_f"], band[col], c=color, marker=marker,
                           s=60, alpha=0.8, label=band_label, edgecolors="black", linewidths=0.5)
                if len(band) >= 2:
                    x = band["temp_f"].values.astype(float)
                    yv = band[col].values.astype(float)
                    z = np.polyfit(x, yv, 1)
                    x_line = np.linspace(x.min(), x.max(), 50)
                    ax.plot(x_line, np.polyval(z, x_line), color=color, ls="--", lw=1.5, alpha=0.5)

            ax.axhline(0, color="gray", ls=":", lw=0.8)
            ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
            ax.set_xlabel("Temperature (F)")
            if j == 0:
                ax.set_ylabel(f"{dev}\nAvg signed error (%)")
            ax.set_title(title)
            if i == 0:
                ax.legend(fontsize=6)

    fig.suptitle(f"Type {PLATE_TYPE} -- Per-Plate Correction (excl. {DAMAGED_DEVICE})", fontsize=14)
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "per_plate_panels.png"))
    print("Saved per_plate_panels.png")
    plt.close(fig)


# ---------------------------------------------------------------------------
# 6. Plot: averaged correction applied to all clean data
# ---------------------------------------------------------------------------
if summary_clean:
    avg_c = summary_clean["avg_c"]
    avg_k = summary_clean["avg_k"]
    clean_devs = {r["device_id"] for r in clean_results}
    cdf = df[df["device_id"].isin(clean_devs)].copy()

    delta_t = cdf["delta_t"].values.astype(float)
    force = cdf["force_n"].values.astype(float)
    y = cdf["avg_signed_pct"].values.astype(float)

    cdf["corrected_c"] = y + delta_t * avg_c * 100.0
    cdf["corrected_ck"] = y + (delta_t * avg_c + delta_t * avg_k * (force - FREF) / FREF) * 100.0

    # Bucket for cleaner plotting
    cdf["temp_bucket"] = (cdf["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE + IDEAL_TEMP_F

    fig, axes = plt.subplots(1, 3, figsize=(18, 6), sharey=True)
    for ax, col, title in [
        (axes[0], "avg_signed_pct", "No correction"),
        (axes[1], "corrected_c", f"After avg c={avg_c:.5f}"),
        (axes[2], "corrected_ck", f"After avg c={avg_c:.5f} k={avg_k:.6f}"),
    ]:
        for band_label, flo, fhi, color, marker in force_bands:
            band = cdf[(cdf["force_n"] >= flo) & (cdf["force_n"] < fhi)]
            if band.empty:
                continue
            # Bucket-average for cleaner plotting
            for bucket, grp in band.groupby("temp_bucket"):
                ax.scatter(bucket, grp[col].mean(), c=color, marker=marker,
                           s=80, alpha=0.8, edgecolors="black", linewidths=0.5,
                           label=band_label if bucket == band["temp_bucket"].min() else "")

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel(f"Temperature (F) -- {BUCKET_SIZE:.0f}F buckets")
        ax.set_ylabel("Avg signed error (%)")
        ax.set_title(title)
        ax.legend(fontsize=7)

    fig.suptitle(
        f"Type {PLATE_TYPE} -- Averaged Per-Plate Coefficients (excl. {DAMAGED_DEVICE})\n"
        f"c={avg_c:.6f} (std={summary_clean['std_c']:.6f}), "
        f"k={avg_k:.6f} (std={summary_clean['std_k']:.6f})\n"
        f"|error|: {summary_clean['mean_abs_before']:.2f}% -> c: {summary_clean['mean_abs_after_c']:.2f}% "
        f"-> c+k: {summary_clean['mean_abs_after_ck']:.2f}%",
        fontsize=11,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "averaged_summary.png"))
    print("Saved averaged_summary.png")
    plt.close(fig)


print("\nDone. Check output/ for results.")
