"""
C Linearity Investigation
==========================
Question: Does the stage-1 correction actually scale cell output by the predicted
factor?  The model says:  processed_on = processed_off * (1 - (76 - T) * c)

We check this cell-by-cell:
  1. Get processed-off cell mean_n values (no correction)
  2. Get processed-on cell mean_n values (at a known c)
  3. Compute predicted = off * (1 - deltaT * c),  deltaT = 76 - temp_f
  4. Compare predicted vs actual

If the pipeline is faithful, actual/off should equal (1 - deltaT * c) for every cell.

Outputs (in output/):
  - cell_comparison.csv         — per-cell off, actual_on, predicted_on, ratios
  - predicted_vs_actual.png     — scatter: predicted scaling vs actual scaling (should be y=x)
  - residual_vs_force.png       — (actual - predicted) ratio vs cell force level
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

OUT = ensure_output_dir(__file__)
PLATE_TYPE = "06"
MAX_TESTS_PER_DEVICE = 2
IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))

tmin = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MIN_F", 71.0))
tmax = float(getattr(config, "TEMP_BASELINE_ROOM_TEMP_MAX_F", 77.0))

# --- Discover tests ---
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices if d.startswith(PLATE_TYPE + ".")]
print(f"Plate type {PLATE_TYPE}: {len(pt_devices)} devices")

# Load the stage-split CSV to know which c values were already processed
stage_split_csv = os.path.join(data_dir("analysis"), "temp_coef_stage_split_reports", f"type{PLATE_TYPE}-stage-split.csv")
if not os.path.isfile(stage_split_csv):
    print(f"No stage-split CSV at {stage_split_csv}. Run the search first.")
    sys.exit(1)

ss_df = pd.read_csv(stage_split_csv)
print(f"Stage-split CSV: {len(ss_df)} rows")

# Build test list: use the best_bw_coef from stage-split as the c value to check
test_list = []
for dev in pt_devices:
    dev_rows = ss_df[ss_df["device_id"] == dev]
    count = 0
    for _, row in dev_rows.iterrows():
        raw_csv_base = row["raw_csv"]
        # Find full path
        tests = repo.list_temperature_tests(dev)
        raw_csv_full = None
        for t in tests:
            if os.path.basename(t) == raw_csv_base:
                raw_csv_full = t
                break
        if not raw_csv_full:
            continue

        meta = repo.load_temperature_meta_for_csv(raw_csv_full)
        if not meta:
            continue

        temp_f = repo.extract_temperature_f(meta)
        if temp_f is None:
            continue

        c_val = row.get("best_bw_coef")
        if c_val is None or pd.isna(c_val):
            continue

        test_list.append({
            "device_id": dev,
            "raw_csv": raw_csv_full,
            "raw_csv_base": raw_csv_base,
            "meta": meta,
            "temp_f": temp_f,
            "delta_t": IDEAL_TEMP_F - temp_f,  # (76 - T)
            "c": float(c_val),
            "body_weight_n": row.get("body_weight_n"),
        })
        count += 1
        if count >= MAX_TESTS_PER_DEVICE:
            break

print(f"Selected {len(test_list)} tests")

# --- For each test, get processed-off and processed-on cell values ---
cell_rows = []
for ti, t in enumerate(test_list):
    label = f"{t['device_id']} T={t['temp_f']:.0f}F c={t['c']:.4f}"
    print(f"[{ti+1}/{len(test_list)}] {label}")

    c_val = round(t["c"], 4)

    # Ensure processed-off (c=0) exists
    processing.run_temperature_processing(
        folder=os.path.dirname(t["raw_csv"]),
        device_id=t["device_id"],
        csv_path=t["raw_csv"],
        slopes={"x": 0.0, "y": 0.0, "z": 0.0},
        room_temp_f=IDEAL_TEMP_F,
        mode="scalar",
    )
    # Ensure processed-on (c=c_val) exists
    processing.run_temperature_processing(
        folder=os.path.dirname(t["raw_csv"]),
        device_id=t["device_id"],
        csv_path=t["raw_csv"],
        slopes={"x": c_val, "y": c_val, "z": c_val},
        room_temp_f=IDEAL_TEMP_F,
        mode="scalar",
    )

    # Get processed paths
    details = repo.get_temperature_test_details(t["raw_csv"])
    proc_runs = list((details or {}).get("processed_runs") or [])

    baseline_path = ""
    selected_path = ""
    for r in proc_runs:
        if r.get("is_baseline") and not baseline_path:
            baseline_path = str(r.get("path") or "")
    for r in proc_runs:
        if r.get("is_baseline"):
            continue
        slopes = dict((r.get("slopes") or {}) if isinstance(r, dict) else {})
        try:
            rx = float(slopes.get("x", 0))
            ry = float(slopes.get("y", 0))
            rz = float(slopes.get("z", 0))
        except Exception:
            continue
        if f"{rx:.6f}" == f"{c_val:.6f}" and f"{ry:.6f}" == f"{c_val:.6f}" and f"{rz:.6f}" == f"{c_val:.6f}":
            selected_path = str(r.get("path") or "")
            break

    if not (baseline_path and selected_path and os.path.isfile(baseline_path) and os.path.isfile(selected_path)):
        print(f"  Skipping — missing processed files")
        continue

    # Analyze: baseline (off) vs selected (on) — synced windows
    payload = analyzer.analyze_temperature_processed_runs(baseline_path, selected_path, t["meta"])

    baseline_data = payload.get("baseline") or {}
    selected_data = payload.get("selected") or {}

    # Extract per-cell mean_n from both, matched by (stage, row, col)
    for stage_key in ("bw", "db"):
        off_stage = (baseline_data.get("stages") or {}).get(stage_key, {})
        on_stage = (selected_data.get("stages") or {}).get(stage_key, {})

        off_cells = {(c["row"], c["col"]): c for c in (off_stage.get("cells") or [])}
        on_cells = {(c["row"], c["col"]): c for c in (on_stage.get("cells") or [])}

        for (row, col), off_cell in off_cells.items():
            on_cell = on_cells.get((row, col))
            if on_cell is None:
                continue

            off_n = float(off_cell["mean_n"])
            actual_on_n = float(on_cell["mean_n"])

            if off_n == 0:
                continue

            # Model prediction: on = off * (1 - deltaT * c)
            predicted_scale = 1.0 - t["delta_t"] * t["c"]
            predicted_on_n = off_n * predicted_scale
            actual_scale = actual_on_n / off_n

            cell_rows.append({
                "device_id": t["device_id"],
                "raw_csv": t["raw_csv_base"],
                "temp_f": t["temp_f"],
                "delta_t": t["delta_t"],
                "c": t["c"],
                "stage": stage_key,
                "row": row,
                "col": col,
                "off_n": off_n,
                "actual_on_n": actual_on_n,
                "predicted_on_n": predicted_on_n,
                "actual_scale": actual_scale,
                "predicted_scale": predicted_scale,
                "residual": actual_scale - predicted_scale,
            })

# --- Save CSV ---
df = pd.DataFrame(cell_rows)
csv_path = os.path.join(OUT, "cell_comparison.csv")
df.to_csv(csv_path, index=False)
print(f"\nSaved {len(df)} cell comparisons to {csv_path}")

if df.empty:
    print("No data — cannot plot.")
    sys.exit(0)

# --- Plot 1: predicted_scale vs actual_scale (should be y=x) ---
fig, ax = plt.subplots(figsize=(8, 8))
for stage_key, marker, color in [("bw", "o", "tab:blue"), ("db", "^", "tab:orange")]:
    s = df[df["stage"] == stage_key]
    if s.empty:
        continue
    ax.scatter(s["predicted_scale"], s["actual_scale"], c=color, marker=marker,
               s=30, alpha=0.6, label=f"{stage_key.upper()} ({len(s)} cells)")

# y=x reference line
all_scales = pd.concat([df["predicted_scale"], df["actual_scale"]])
lo, hi = all_scales.min(), all_scales.max()
margin = (hi - lo) * 0.05
ax.plot([lo - margin, hi + margin], [lo - margin, hi + margin], "r--", lw=1, label="y = x (perfect)")

ax.set_xlabel("Predicted scale: 1 - (76 - T) * c")
ax.set_ylabel("Actual scale: on_mean_n / off_mean_n")
ax.set_title(f"Type {PLATE_TYPE} — Does the correction do what the math says?")
ax.legend()
ax.set_aspect("equal")
plt.tight_layout()
fig.savefig(os.path.join(OUT, "predicted_vs_actual.png"))
print("Saved predicted_vs_actual.png")

# --- Plot 2: residual (actual - predicted) vs off_n (force level) ---
fig, ax = plt.subplots(figsize=(12, 6))
for stage_key, marker, color in [("bw", "o", "tab:blue"), ("db", "^", "tab:orange")]:
    s = df[df["stage"] == stage_key]
    if s.empty:
        continue
    ax.scatter(s["off_n"], s["residual"], c=color, marker=marker,
               s=30, alpha=0.6, label=f"{stage_key.upper()}")

ax.axhline(0, color="gray", ls=":", lw=0.8)
ax.set_xlabel("Cell force (off_mean_n, Newtons)")
ax.set_ylabel("Residual (actual_scale - predicted_scale)")
ax.set_title(f"Type {PLATE_TYPE} — Residual vs force level\n"
             f"If nonzero and force-dependent, that's what k should capture")
ax.legend()
plt.tight_layout()
fig.savefig(os.path.join(OUT, "residual_vs_force.png"))
print("Saved residual_vs_force.png")

# --- Summary stats ---
print(f"\n{'='*60}")
print(f"Residual stats (actual_scale - predicted_scale):")
print(f"  Mean:   {df['residual'].mean():.6f}")
print(f"  Std:    {df['residual'].std():.6f}")
print(f"  Max:    {df['residual'].max():.6f}")
print(f"  Min:    {df['residual'].min():.6f}")
print(f"{'='*60}")
print("\nDone. Check output/ for results.")
