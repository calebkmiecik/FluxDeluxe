"""
Error Surface Investigation
============================
For each non-baseline test (processed-off, no correction), compute the
bias-corrected average error across all cells.  Each test has a known
weight (from meta) and temperature, giving us a 3D picture:

    (temperature, force, avg_error)

The shape of this surface tells us how c and k relate:
  - If error varies with temp but not force → c alone is enough, k ≈ 0
  - If error tilts with force at a given temp → that tilt is k

Outputs (in output/):
  - error_surface.csv                   — per-test: temp, force, stage, avg_error (all plates)
  - error_surface_excl_25.csv           — same, excluding 06.00000025
  - error_surface_3d.png                — 3D scatter (all plates)
  - error_surface_3d_excl_25.png        — 3D scatter (excluding 06.00000025)
  - error_vs_temp_by_force.png          — 2D: error vs temp, colored by force band
  - error_vs_temp_by_force_excl_25.png  — same, excluding 06.00000025
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

from mpl_toolkits.mplot3d import Axes3D

OUT = ensure_output_dir(__file__)
PLATE_TYPE = "06"
IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
DAMAGED_DEVICE = "06.00000025"

tmin = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MIN_F", 71.0))
tmax = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MAX_F", 77.0))

# --- Discover devices ---
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices if d.startswith(PLATE_TYPE + ".")]
print(f"Plate type {PLATE_TYPE}: {len(pt_devices)} devices")

# --- For each device, load bias map and evaluate non-baseline tests ---
test_rows = []

for dev in pt_devices:
    # Load bias map
    bias_cache = repo.load_temperature_bias_cache(dev) or {}
    bias_map = (bias_cache.get("bias_all") or bias_cache.get("bias")) if isinstance(bias_cache, dict) else None
    if not isinstance(bias_map, list):
        print(f"  {dev}: no bias map, skipping")
        continue

    # Find baseline and non-baseline tests
    baseline_entries = repo.list_temperature_room_baseline_tests(dev, min_temp_f=tmin, max_temp_f=tmax) or []
    bl_csvs = {str(e.get("csv_path") or "") for e in baseline_entries if str(e.get("csv_path") or "")}
    tests = repo.list_temperature_tests(dev)

    non_bl = [t for t in tests if t not in bl_csvs]
    print(f"  {dev}: {len(non_bl)} non-baseline tests")

    for raw_csv in non_bl:
        meta = repo.load_temperature_meta_for_csv(raw_csv)
        if not meta:
            continue

        temp_f = repo.extract_temperature_f(meta)
        if temp_f is None:
            continue

        body_weight_n = None
        try:
            body_weight_n = float(meta.get("body_weight_n"))
        except Exception:
            pass

        # Get processed-off file (baseline in the analyzer's sense = correction OFF)
        details = repo.get_temperature_test_details(raw_csv)
        proc_runs = list((details or {}).get("processed_runs") or [])

        baseline_path = ""
        for r in proc_runs:
            if r.get("is_baseline") and not baseline_path:
                baseline_path = str(r.get("path") or "")

        if not (baseline_path and os.path.isfile(baseline_path)):
            # Ensure processed-off exists
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

        # Analyze the processed-off file to get per-cell mean_n
        single = analyzer.analyze_single_processed_csv(baseline_path, meta)
        data = single.get("data") or {}
        grid = single.get("grid") or {}
        device_type = str(grid.get("device_type") or PLATE_TYPE)

        stages_data = data.get("stages") or {}

        for stage_key in ("bw", "db"):
            stage = stages_data.get(stage_key, {})
            target_n = float(stage.get("target_n") or 0.0)
            if target_n <= 0:
                continue

            cells = stage.get("cells") or []
            if not cells:
                continue

            # Compute bias-corrected signed error per cell, then average
            signed_errors = []
            for cell in cells:
                row_idx = int(cell.get("row", 0))
                col_idx = int(cell.get("col", 0))
                mean_n = float(cell.get("mean_n", 0.0))

                # Apply bias correction: adjusted_target = target * (1 + bias)
                try:
                    cell_bias = float(bias_map[row_idx][col_idx])
                except Exception:
                    cell_bias = 0.0
                adjusted_target = target_n * (1.0 + cell_bias)

                if adjusted_target <= 0:
                    continue

                signed_pct = (mean_n - adjusted_target) / adjusted_target * 100.0
                signed_errors.append(signed_pct)

            if not signed_errors:
                continue

            avg_signed = sum(signed_errors) / len(signed_errors)
            avg_abs = sum(abs(e) for e in signed_errors) / len(signed_errors)

            force_n = target_n  # BW target = body weight, DB target = dumbbell weight

            test_rows.append({
                "device_id": dev,
                "raw_csv": os.path.basename(raw_csv),
                "temp_f": temp_f,
                "delta_t": temp_f - IDEAL_TEMP_F,
                "stage": stage_key,
                "force_n": force_n,
                "n_cells": len(signed_errors),
                "avg_signed_pct": avg_signed,
                "avg_abs_pct": avg_abs,
                "is_damaged": dev == DAMAGED_DEVICE,
            })

# --- Save CSVs ---
df = pd.DataFrame(test_rows)
df.to_csv(os.path.join(OUT, "error_surface.csv"), index=False)

df_clean = df[~df["is_damaged"]].copy()
df_clean.to_csv(os.path.join(OUT, "error_surface_excl_25.csv"), index=False)

print(f"\n{len(df)} test-stage entries ({len(df_clean)} excluding {DAMAGED_DEVICE})")

if df.empty:
    print("No data — cannot plot.")
    sys.exit(0)


def make_plots(plot_df, suffix=""):
    """Generate 3D scatter and 2D temp-vs-error plots."""
    tag = f" (excl {DAMAGED_DEVICE})" if suffix else " (all plates)"

    # --- 3D scatter ---
    fig = plt.figure(figsize=(12, 8))
    ax = fig.add_subplot(111, projection="3d")

    for stage_key, marker, color in [("bw", "o", "tab:blue"), ("db", "^", "tab:orange")]:
        s = plot_df[plot_df["stage"] == stage_key]
        if s.empty:
            continue
        ax.scatter(
            s["temp_f"], s["force_n"], s["avg_signed_pct"],
            c=color, marker=marker, s=40, alpha=0.7, label=f"{stage_key.upper()}",
        )

    ax.set_xlabel("Temperature (°F)")
    ax.set_ylabel("Force (N)")
    ax.set_zlabel("Avg signed error (%)")
    ax.set_title(f"Type {PLATE_TYPE} — Error surface{tag}")
    ax.legend()
    plt.tight_layout()
    fname = f"error_surface_3d{suffix}.png"
    fig.savefig(os.path.join(OUT, fname))
    print(f"Saved {fname}")
    plt.close(fig)

    # --- 2D: error vs temp, colored by force ---
    fig, ax = plt.subplots(figsize=(12, 6))

    # Color by force level using a continuous colormap
    forces = plot_df["force_n"].values
    scatter = ax.scatter(
        plot_df["temp_f"], plot_df["avg_signed_pct"],
        c=forces, cmap="viridis", s=50, alpha=0.7,
    )
    cbar = plt.colorbar(scatter, ax=ax)
    cbar.set_label("Force (N)")

    # Add trend line per force band
    force_bands = [
        ("DB ~200N", 100, 300, "tab:orange"),
        ("BW 500-750N", 500, 750, "tab:green"),
        ("BW 750-950N", 750, 950, "tab:blue"),
        ("BW 950-1200N", 950, 1200, "tab:red"),
    ]
    for label, flo, fhi, color in force_bands:
        band = plot_df[(plot_df["force_n"] >= flo) & (plot_df["force_n"] < fhi)]
        if len(band) < 2:
            continue
        x = band["temp_f"].values.astype(float)
        y = band["avg_signed_pct"].values.astype(float)
        z = np.polyfit(x, y, 1)
        x_line = np.linspace(x.min(), x.max(), 50)
        ax.plot(x_line, np.polyval(z, x_line), color=color, ls="--", lw=2,
                label=f"{label}: slope={z[0]:.3f}%/°F")

    ax.axhline(0, color="gray", ls=":", lw=0.8)
    ax.set_xlabel("Temperature (°F)")
    ax.set_ylabel("Avg signed error (%)")
    ax.set_title(f"Type {PLATE_TYPE} — Error vs temp by force band{tag}\n"
                 f"If slopes differ by force band, k is nonzero")
    ax.legend(fontsize=8)
    plt.tight_layout()
    fname = f"error_vs_temp_by_force{suffix}.png"
    fig.savefig(os.path.join(OUT, fname))
    print(f"Saved {fname}")
    plt.close(fig)


make_plots(df, suffix="")
make_plots(df_clean, suffix="_excl_25")

# --- Summary ---
print(f"\n{'='*60}")
print("Trend line slopes by force band (excl 06.00000025):")
print("(slope = %error per degF -- should equal c * 100 if model holds)")
print(f"{'='*60}")
force_bands = [
    ("DB ~200N", 100, 300),
    ("BW 500-750N", 500, 750),
    ("BW 750-950N", 750, 950),
    ("BW 950-1200N", 950, 1200),
]
for label, flo, fhi in force_bands:
    band = df_clean[(df_clean["force_n"] >= flo) & (df_clean["force_n"] < fhi)]
    if len(band) < 2:
        print(f"  {label}: insufficient data ({len(band)} points)")
        continue
    x = band["temp_f"].values.astype(float)
    y = band["avg_signed_pct"].values.astype(float)
    z = np.polyfit(x, y, 1)
    implied_c = z[0] / 100.0
    print(f"  {label}: slope = {z[0]:.4f} %/degF  =>  implied c = {implied_c:.6f}  ({len(band)} points)")

print(f"\nIf implied c varies with force band, k is needed.")
print("Done. Check output/ for results.")
