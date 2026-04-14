"""
Final Report Generator
=======================
Generates publication-quality plots and statistics for the chosen c and k values.

For each plate type configuration:
  - Before/after plots with force bands
  - R2 and p-value of error vs temperature (before and after correction)
  - Proves remaining error is not temperature-correlated

Usage:
  python final_report.py

Edit CONFIGS below to set the final values for each plate type.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *
from scipy import stats as scipy_stats

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output_final")
os.makedirs(OUT, exist_ok=True)

IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
BUCKET_SIZE = 5.0

# ===== FINAL VALUES =====
CONFIGS = [
    {
        "label": "Type 06 (Lite)",
        "plate_types": ["06"],
        "exclude": {"06.00000025"},
        "c": 0.0014,
        "k": 0.0,
        "fref": 550.0,
    },
    {
        "label": "Type 07+11 (Launchpad)",
        "plate_types": ["07", "11"],
        "exclude": set(),
        "c": 0.0015,
        "k": 0.0,
        "fref": 550.0,
    },
    {
        "label": "Type 08+12 (XL)",
        "plate_types": ["08", "12"],
        "exclude": {"08.00000038"},
        "c": 0.0010,
        "k": 0.0010,
        "fref": 550.0,
    },
]

FORCE_BANDS = [
    ("DB 100-300N",  100,  300, "tab:orange", "^"),
    ("BW 500-700N",  500,  700, "tab:green",  "o"),
    ("BW 700-900N",  700,  900, "tab:blue",   "s"),
    ("BW 900-1100N", 900, 1100, "tab:red",    "D"),
    ("BW 1100N+",   1100, 9999, "tab:purple",  "P"),
]


def collect_data(plate_types, exclude):
    """Collect all test-stage data for given plate types."""
    all_devices = repo.list_temperature_devices() or []
    devices = [d for d in all_devices
               if d.split(".", 1)[0] in plate_types and d not in exclude]

    rows = []
    for dev in sorted(devices):
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
                continue

            baseline_result = analyzer.analyze_single_processed_csv(baseline_path, meta)
            baseline_stages = (baseline_result.get("data") or {}).get("stages") or {}
            delta_t = temp_f - IDEAL_TEMP_F

            for stage_key in ("bw", "db"):
                bl_stage = baseline_stages.get(stage_key, {})
                target_n = float(bl_stage.get("target_n") or 0.0)
                if target_n <= 0:
                    continue
                bl_cells = bl_stage.get("cells") or []
                if not bl_cells:
                    continue

                bl_errors = [(float(c.get("mean_n", 0.0)) - target_n) / target_n * 100.0
                             for c in bl_cells]

                rows.append({
                    "device_id": dev,
                    "temp_f": temp_f,
                    "delta_t": delta_t,
                    "stage": stage_key,
                    "force_n": target_n,
                    "baseline_error": sum(bl_errors) / len(bl_errors),
                })
    return pd.DataFrame(rows)


def collect_pipeline_data(plate_types, exclude, c_val):
    """Collect pipeline-processed data for a specific c value."""
    all_devices = repo.list_temperature_devices() or []
    devices = [d for d in all_devices
               if d.split(".", 1)[0] in plate_types and d not in exclude]

    rows = []
    for dev in sorted(devices):
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

            # Find baseline
            baseline_path = ""
            for r in proc_runs:
                if r.get("is_baseline") and not baseline_path:
                    baseline_path = str(r.get("path") or "")
            if not (baseline_path and os.path.isfile(baseline_path)):
                continue

            # Find c-processed file
            selected_path = ""
            for r in proc_runs:
                if r.get("is_baseline"):
                    continue
                s = r.get("slopes") or {}
                if (abs(float(s.get("x", 0)) - c_val) < 0.00001 and
                    abs(float(s.get("z", 0)) - c_val) < 0.00001):
                    p = str(r.get("path") or "")
                    if p and os.path.isfile(p):
                        selected_path = p
                        break

            if not selected_path:
                continue

            # Analyze both
            baseline_result = analyzer.analyze_single_processed_csv(baseline_path, meta)
            selected_result = analyzer.analyze_single_processed_csv(selected_path, meta)
            baseline_stages = (baseline_result.get("data") or {}).get("stages") or {}
            selected_stages = (selected_result.get("data") or {}).get("stages") or {}
            delta_t = temp_f - IDEAL_TEMP_F

            for stage_key in ("bw", "db"):
                bl_stage = baseline_stages.get(stage_key, {})
                sel_stage = selected_stages.get(stage_key, {})
                target_n = float(bl_stage.get("target_n") or 0.0)
                if target_n <= 0:
                    continue
                bl_cells = bl_stage.get("cells") or []
                sel_cells = sel_stage.get("cells") or []
                if not bl_cells or not sel_cells:
                    continue

                bl_errors = [(float(c.get("mean_n", 0.0)) - target_n) / target_n * 100.0
                             for c in bl_cells]
                sel_errors = [(float(c.get("mean_n", 0.0)) - target_n) / target_n * 100.0
                              for c in sel_cells]

                rows.append({
                    "device_id": dev,
                    "temp_f": temp_f,
                    "delta_t": delta_t,
                    "stage": stage_key,
                    "force_n": target_n,
                    "baseline_error": sum(bl_errors) / len(bl_errors),
                    "after_c": sum(sel_errors) / len(sel_errors),
                })
    return pd.DataFrame(rows)


def compute_temp_correlation(temps, errors, weights):
    """Compute weighted R2 and p-value of error vs temperature."""
    # Weighted linear regression: error = a + b*temp
    sw = np.sqrt(weights)
    X = np.column_stack([np.ones_like(temps), temps])
    beta = np.linalg.lstsq(X * sw[:, None], errors * sw, rcond=None)[0]
    predicted = X @ beta
    ss_res = np.sum(weights * (errors - predicted) ** 2)
    ss_tot = np.sum(weights * (errors - np.average(errors, weights=weights)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # Unweighted scipy for p-value (weighted p-value is complex)
    slope, intercept, r_val, p_val, std_err = scipy_stats.linregress(temps, errors)

    return {
        "r2": r2,
        "slope": beta[1],
        "p_value": p_val,
        "r_unweighted": r_val,
    }


# ===================================================================
# Generate report for each config
# ===================================================================
all_stats = []

for cfg in CONFIGS:
    label = cfg["label"]
    plate_types = cfg["plate_types"]
    exclude = cfg["exclude"]
    c_val = cfg["c"]
    k_val = cfg["k"]
    fref = cfg["fref"]
    plate_label = "+".join(plate_types)

    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"  c = {c_val}, k = {k_val}" + (f", FREF = {fref}" if k_val else ""))
    print(f"{'='*70}")

    # Collect pipeline data
    df = collect_pipeline_data(plate_types, exclude, c_val)
    if df.empty:
        print(f"  No pipeline data found for c={c_val}!")
        continue

    # Apply k post-correction
    delta_t = df["delta_t"].values.astype(float)
    force = df["force_n"].values.astype(float)
    after_c = df["after_c"].values.astype(float)

    if k_val != 0:
        after_ck = after_c + k_val * 100.0 * delta_t * (force - fref) / fref
    else:
        after_ck = after_c.copy()
    df["after_ck"] = after_ck

    # Temperature-bucket weighting
    df["temp_bucket"] = (df["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bc = df.groupby("temp_bucket").size().to_dict()
    df["weight"] = df["temp_bucket"].map(lambda b: 1.0 / bc[b])
    w = df["weight"].values.astype(float)

    baseline = df["baseline_error"].values.astype(float)
    temps = df["temp_f"].values.astype(float)

    # wMAE and MAE
    wmae_baseline = np.average(np.abs(baseline), weights=w)
    wmae_c = np.average(np.abs(after_c), weights=w)
    wmae_ck = np.average(np.abs(after_ck), weights=w)
    mae_baseline = np.mean(np.abs(baseline))
    mae_c = np.mean(np.abs(after_c))
    mae_ck = np.mean(np.abs(after_ck))

    # Temperature correlation stats
    corr_before = compute_temp_correlation(temps, baseline, w)
    corr_after_c = compute_temp_correlation(temps, after_c, w)
    corr_after_ck = compute_temp_correlation(temps, after_ck, w)

    print(f"\n  {len(df)} test-stage points")
    print(f"\n  Performance (weighted MAE — equal weight per temp bucket):")
    print(f"    Baseline wMAE:       {wmae_baseline:.3f}%")
    print(f"    After c wMAE:        {wmae_c:.3f}%")
    if k_val:
        print(f"    After c+k wMAE:      {wmae_ck:.3f}%")
    print(f"    Reduction:           {100*(1 - wmae_ck/wmae_baseline):.0f}%")
    print(f"\n  Performance (unweighted MAE — raw average across all tests):")
    print(f"    Baseline MAE:        {mae_baseline:.3f}%")
    print(f"    After c MAE:         {mae_c:.3f}%")
    if k_val:
        print(f"    After c+k MAE:       {mae_ck:.3f}%")
    print(f"    Reduction:           {100*(1 - mae_ck/mae_baseline):.0f}%")

    print(f"\n  Temperature correlation (is error related to temperature?):")
    print(f"    Before correction:")
    print(f"      R2 = {corr_before['r2']:.4f}, slope = {corr_before['slope']:+.4f} %/°F, p = {corr_before['p_value']:.2e}")
    print(f"    After c:")
    print(f"      R2 = {corr_after_c['r2']:.4f}, slope = {corr_after_c['slope']:+.4f} %/°F, p = {corr_after_c['p_value']:.2e}")
    if k_val:
        print(f"    After c+k:")
        print(f"      R2 = {corr_after_ck['r2']:.4f}, slope = {corr_after_ck['slope']:+.4f} %/°F, p = {corr_after_ck['p_value']:.2e}")

    final_corr = corr_after_ck if k_val else corr_after_c
    if final_corr["p_value"] > 0.05:
        print(f"\n    --> Remaining error is NOT significantly correlated with temperature (p={final_corr['p_value']:.2f})")
    else:
        print(f"\n    --> Remaining error still shows some temperature correlation (p={final_corr['p_value']:.2e})")

    # Per-plate breakdown
    print(f"\n  Per-plate:")
    for dev in sorted(df["device_id"].unique()):
        dv = df[df["device_id"] == dev]
        dw = dv["weight"].values
        bl_w = np.average(np.abs(dv["baseline_error"].values), weights=dw)
        ck_w = np.average(np.abs(dv["after_ck"].values), weights=dw)
        n = len(dv)
        print(f"    {dev}: n={n:2d}, baseline={bl_w:.2f}%, final={ck_w:.2f}%")

    stat_row = {
        "plate_type": label,
        "c": c_val, "k": k_val,
        "n_points": len(df),
        "wmae_baseline": wmae_baseline,
        "wmae_after_c": wmae_c,
        "wmae_final": wmae_ck,
        "reduction_wmae_pct": 100 * (1 - wmae_ck / wmae_baseline),
        "mae_baseline": mae_baseline,
        "mae_after_c": mae_c,
        "mae_final": mae_ck,
        "reduction_mae_pct": 100 * (1 - mae_ck / mae_baseline),
        "r2_before": corr_before["r2"],
        "slope_before": corr_before["slope"],
        "p_before": corr_before["p_value"],
        "r2_after": final_corr["r2"],
        "slope_after": final_corr["slope"],
        "p_after": final_corr["p_value"],
    }
    all_stats.append(stat_row)

    # ===================================================================
    # Plot: 3-panel (or 2-panel if k=0) with force bands
    # ===================================================================
    if k_val:
        n_panels = 3
        panels = [
            ("No correction", "baseline_error"),
            (f"After c = {c_val}", "after_c"),
            (f"After c = {c_val}, k = {k_val}", "after_ck"),
        ]
    else:
        n_panels = 2
        panels = [
            ("No correction", "baseline_error"),
            (f"After c = {c_val}", "after_c"),
        ]

    fig, axes = plt.subplots(1, n_panels, figsize=(8 * n_panels, 6), sharey=True)
    if n_panels == 1:
        axes = [axes]

    for ax, (title, data_col) in zip(axes, panels):
        data_vals = df[data_col].values.astype(float)
        corr = compute_temp_correlation(temps, data_vals, w)

        for band_label, flo, fhi, color, marker in FORCE_BANDS:
            band = df[(df["force_n"] >= flo) & (df["force_n"] < fhi)]
            if band.empty:
                continue
            ax.scatter(band["temp_f"], band[data_col], marker=marker,
                       c=color, s=50, alpha=0.7,
                       edgecolors="black", linewidths=0.3, label=band_label)
            if len(band) >= 2:
                z = np.polyfit(band["temp_f"].values, band[data_col].values, 1)
                x_line = np.linspace(band["temp_f"].min(), band["temp_f"].max(), 50)
                ax.plot(x_line, np.polyval(z, x_line), color=color,
                        ls="--", lw=1.5, alpha=0.5)

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel("Temperature (°F)")
        ax.set_ylabel("Signed error (%)")

        wmae_panel = np.average(np.abs(data_vals), weights=w)
        p_str = f"p={corr['p_value']:.2e}" if corr['p_value'] < 0.001 else f"p={corr['p_value']:.3f}"
        ax.set_title(f"{title}\nwMAE = {wmae_panel:.2f}%  |  R\u00b2 = {corr['r2']:.3f}  |  {p_str}")
        ax.legend(fontsize=7, loc="best")

    fig.suptitle(
        f"{label} — Final Correction: c = {c_val}" + (f", k = {k_val}" if k_val else "") + "\n"
        f"wMAE: {wmae_baseline:.2f}% → {wmae_ck:.2f}% ({100*(1 - wmae_ck/wmae_baseline):.0f}% reduction)",
        fontsize=13,
    )
    plt.tight_layout()
    fname = f"final_{plate_label}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150)
    print(f"\n  Saved {fname}")
    plt.close(fig)


# ===================================================================
# Save stats
# ===================================================================
pd.DataFrame(all_stats).to_csv(os.path.join(OUT, "final_stats.csv"), index=False)

# Print summary table
print(f"\n\n{'='*80}")
print("  FINAL SUMMARY")
print(f"{'='*80}\n")
print(f"  Weighted MAE (equal weight per temperature bucket):")
print(f"  {'Plate Type':<25s}  {'c':>7s}  {'k':>7s}  {'Baseline':>9s}  {'Final':>7s}  {'Reduction':>9s}  {'R2 before':>9s}  {'R2 after':>9s}  {'p after':>10s}")
print(f"  {'':->25s}  {'':->7s}  {'':->7s}  {'':->9s}  {'':->7s}  {'':->9s}  {'':->9s}  {'':->9s}  {'':->10s}")
for s in all_stats:
    print(f"  {s['plate_type']:<25s}  {s['c']:7.4f}  {s['k']:7.4f}  {s['wmae_baseline']:8.2f}%  {s['wmae_final']:6.2f}%  {s['reduction_wmae_pct']:8.0f}%  {s['r2_before']:9.4f}  {s['r2_after']:9.4f}  {s['p_after']:10.3e}")

print(f"\n  Unweighted MAE (raw average across all tests):")
print(f"  {'Plate Type':<25s}  {'Baseline':>9s}  {'Final':>7s}  {'Reduction':>9s}")
print(f"  {'':->25s}  {'':->9s}  {'':->7s}  {'':->9s}")
for s in all_stats:
    print(f"  {s['plate_type']:<25s}  {s['mae_baseline']:8.2f}%  {s['mae_final']:6.2f}%  {s['reduction_mae_pct']:8.0f}%")

print(f"\n  Saved final_stats.csv and plots to output_final/")
print("\nDone.")
