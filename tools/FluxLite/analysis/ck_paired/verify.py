"""
Verify projected vs actual pipeline results for multiple c values on Type 06.

For each c value and each test, compares:
  - Baseline (temp OFF): actual signed error from pipeline
  - Projected after c: baseline error + deltaT * c * 100
  - Actual after c: real pipeline output with slopes={x:c, y:c, z:c}

Usage: python verify.py
  (edit C_VALUES below to add/remove candidates)
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

OUT = ensure_output_dir(__file__)

PLATE_TYPE = "06"
EXCLUDE_DEVICES = {"06.00000025"}
C_VALUES = [0.0014, 0.0019]
IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
FREF = 550.0
BUCKET_SIZE = 5.0

print(f"Verifying c values {C_VALUES} for plate type {PLATE_TYPE}")
print(f"Excluding: {EXCLUDE_DEVICES}")
print()

# ===========================================================================
# 1. Collect data: baseline + each c value's pipeline result
# ===========================================================================
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices
              if d.startswith(PLATE_TYPE + ".") and d not in EXCLUDE_DEVICES]

rows = []
for dev in sorted(pt_devices):
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

        # Find each c value's processed file
        selected_paths = {}
        for c_val in C_VALUES:
            for r in proc_runs:
                if r.get("is_baseline"):
                    continue
                s = r.get("slopes") or {}
                if (abs(float(s.get("x", 0)) - c_val) < 0.00001 and
                    abs(float(s.get("z", 0)) - c_val) < 0.00001):
                    p = str(r.get("path") or "")
                    if p and os.path.isfile(p):
                        selected_paths[c_val] = p
                        break

        # Analyze baseline
        baseline_result = analyzer.analyze_single_processed_csv(baseline_path, meta)
        baseline_stages = (baseline_result.get("data") or {}).get("stages") or {}

        # Analyze each c value
        selected_stages_by_c = {}
        for c_val, sel_path in selected_paths.items():
            sel_result = analyzer.analyze_single_processed_csv(sel_path, meta)
            selected_stages_by_c[c_val] = (sel_result.get("data") or {}).get("stages") or {}

        delta_t = temp_f - IDEAL_TEMP_F

        for stage_key in ("bw", "db"):
            bl_stage = baseline_stages.get(stage_key, {})
            target_n = float(bl_stage.get("target_n") or 0.0)
            if target_n <= 0:
                continue
            bl_cells = bl_stage.get("cells") or []
            if not bl_cells:
                continue

            # Baseline error (no bias correction)
            bl_errors = [(float(c.get("mean_n", 0.0)) - target_n) / target_n * 100.0
                         for c in bl_cells]
            bl_avg = sum(bl_errors) / len(bl_errors)

            row = {
                "device_id": dev,
                "raw_csv": os.path.basename(raw_csv),
                "temp_f": temp_f,
                "delta_t": delta_t,
                "stage": stage_key,
                "force_n": target_n,
                "baseline_error": bl_avg,
            }

            for c_val in C_VALUES:
                projected = bl_avg + delta_t * c_val * 100.0
                row[f"projected_{c_val}"] = projected

                actual = None
                sel_stages = selected_stages_by_c.get(c_val, {})
                sel_stage = sel_stages.get(stage_key, {})
                sel_cells = sel_stage.get("cells") or []
                if sel_cells:
                    sel_errors = [(float(c.get("mean_n", 0.0)) - target_n) / target_n * 100.0
                                  for c in sel_cells]
                    actual = sum(sel_errors) / len(sel_errors)
                row[f"actual_{c_val}"] = actual

            rows.append(row)

df = pd.DataFrame(rows)
print(f"{len(df)} test-stage points")


# ===========================================================================
# 2. Report: compare each c value
# ===========================================================================
for c_val in C_VALUES:
    proj_col = f"projected_{c_val}"
    act_col = f"actual_{c_val}"
    v = df[df[act_col].notna()].copy()

    if v.empty:
        print(f"\n  c={c_val}: No pipeline results found!")
        continue

    v["proj_error"] = v[proj_col] - v[act_col]

    print()
    print("=" * 70)
    print(f"  c = {c_val}  ({len(v)} points with pipeline results)")
    print("=" * 70)
    print(f"  Baseline |error|:  {v['baseline_error'].abs().mean():.2f}%")
    print(f"  Projected |error|: {v[proj_col].abs().mean():.2f}%")
    print(f"  Actual    |error|: {v[act_col].abs().mean():.2f}%")
    print(f"  Projection gap:    mean={v['proj_error'].mean():+.4f}%, std={v['proj_error'].std():.4f}%")

    # Per-device
    for dev in sorted(v["device_id"].unique()):
        dv = v[v["device_id"] == dev]
        print(f"    {dev}: baseline={dv['baseline_error'].abs().mean():.2f}%, "
              f"projected={dv[proj_col].abs().mean():.2f}%, "
              f"actual={dv[act_col].abs().mean():.2f}%, "
              f"gap={dv['proj_error'].mean():+.3f}%")


# ===========================================================================
# 3. Residual model for each c value (weighted)
# ===========================================================================
for c_val in C_VALUES:
    proj_col = f"projected_{c_val}"
    act_col = f"actual_{c_val}"
    v = df[df[act_col].notna()].copy()
    if v.empty:
        continue

    v["proj_error"] = v[proj_col] - v[act_col]

    # Temperature-bucket weighting
    v["temp_bucket"] = (v["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bucket_counts = v.groupby("temp_bucket").size().to_dict()
    v["weight"] = v["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])

    delta_t = v["delta_t"].values.astype(float)
    force = v["force_n"].values.astype(float)
    pe = v["proj_error"].values.astype(float)
    w = v["weight"].values.astype(float)
    sw = np.sqrt(w)

    # Full model (weighted)
    X = np.column_stack([
        np.ones_like(delta_t),
        delta_t,
        (force - FREF) / FREF,
        delta_t * (force - FREF) / FREF,
    ])
    beta = np.linalg.lstsq(X * sw[:, None], pe * sw, rcond=None)[0]
    pe_pred = X @ beta
    ss_res = np.sum(w * (pe - pe_pred) ** 2)
    ss_tot = np.sum(w * (pe - np.average(pe, weights=w)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # Simple model (weighted)
    X_s = np.column_stack([np.ones_like(delta_t), delta_t * (force - FREF) / FREF])
    beta_s = np.linalg.lstsq(X_s * sw[:, None], pe * sw, rcond=None)[0]
    pe_pred_s = X_s @ beta_s
    ss_res_s = np.sum(w * (pe - pe_pred_s) ** 2)
    r2_s = 1.0 - ss_res_s / ss_tot if ss_tot > 0 else 0.0

    k_implied = -beta[3] / 100.0

    print()
    print(f"  --- Residual model for c={c_val} (weighted) ---")
    print(f"  Full: a={beta[0]:+.4f}, b1(dT)={beta[1]:+.4f}, "
          f"b2(F)={beta[2]:+.4f}, b3(dT*F)={beta[3]:+.4f}, wR2={r2:.4f}")
    print(f"  Simple (dT*F only): a={beta_s[0]:+.4f}, b={beta_s[1]:+.4f}, wR2={r2_s:.4f}")
    print(f"  Implied k = {k_implied:.6f}")


# ===========================================================================
# 4. Save data
# ===========================================================================
df.to_csv(os.path.join(OUT, "verification.csv"), index=False)


# ===========================================================================
# 5. Plot: side-by-side comparison of c values
# ===========================================================================
# Find c values that have pipeline data
valid_c = [c for c in C_VALUES if df[f"actual_{c}"].notna().any()]
n_c = len(valid_c)

if n_c > 0:
    # --- Plot A: Actual pipeline |error| comparison ---
    fig, axes = plt.subplots(1, n_c, figsize=(8 * n_c, 6), sharey=True, squeeze=False)
    for i, c_val in enumerate(valid_c):
        ax = axes[0][i]
        v = df[df[f"actual_{c_val}"].notna()].copy()
        for stage_key, style in [("bw", {"marker": "o", "color": "tab:blue", "label": "BW"}),
                                  ("db", {"marker": "^", "color": "tab:orange", "label": "DB"})]:
            s = v[v["stage"] == stage_key]
            # Baseline
            ax.scatter(s["temp_f"], s["baseline_error"], marker=style["marker"],
                       c="lightgray", s=30, alpha=0.4, edgecolors="gray", linewidths=0.3)
            # Actual after c
            ax.scatter(s["temp_f"], s[f"actual_{c_val}"], marker=style["marker"],
                       c=style["color"], s=50, alpha=0.7,
                       edgecolors="black", linewidths=0.3, label=style["label"])

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel("Temperature (F)")
        if i == 0:
            ax.set_ylabel("Signed error (%)")
        mae = v[f"actual_{c_val}"].abs().mean()
        ax.set_title(f"c = {c_val}  |  actual pipeline |error| = {mae:.2f}%")
        ax.legend(fontsize=8)

    fig.suptitle(
        f"Type {PLATE_TYPE} — Pipeline Results Comparison\n"
        f"Gray = baseline (no correction), colored = after correction",
        fontsize=13,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "comparison_actual.png"), dpi=150)
    print(f"\nSaved comparison_actual.png")
    plt.close(fig)

    # --- Plot B: Projection error for each c ---
    fig, axes = plt.subplots(1, n_c, figsize=(8 * n_c, 6), sharey=True, squeeze=False)
    for i, c_val in enumerate(valid_c):
        ax = axes[0][i]
        v = df[df[f"actual_{c_val}"].notna()].copy()
        v["pe"] = v[f"projected_{c_val}"] - v[f"actual_{c_val}"]

        for stage_key, style in [("bw", {"marker": "o", "color": "tab:blue", "label": "BW"}),
                                  ("db", {"marker": "^", "color": "tab:orange", "label": "DB"})]:
            s = v[v["stage"] == stage_key]
            ax.scatter(s["temp_f"], s["pe"], marker=style["marker"],
                       c=style["color"], s=50, alpha=0.7,
                       edgecolors="black", linewidths=0.3, label=style["label"])
            if len(s) >= 2:
                z = np.polyfit(s["temp_f"].values, s["pe"].values, 1)
                x_line = np.linspace(s["temp_f"].min(), s["temp_f"].max(), 50)
                ax.plot(x_line, np.polyval(z, x_line), color=style["color"],
                        ls="--", lw=1.5, alpha=0.5)

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel("Temperature (F)")
        if i == 0:
            ax.set_ylabel("Projection error: projected - actual (%)")
        mae = v["pe"].abs().mean()
        ax.set_title(f"c = {c_val}  |  mean |proj error| = {mae:.3f}%")
        ax.legend(fontsize=8)

    fig.suptitle(
        f"Type {PLATE_TYPE} — Projection Error by c Value\n"
        f"Positive = our model overestimates correction needed",
        fontsize=13,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "comparison_projection_error.png"), dpi=150)
    print(f"Saved comparison_projection_error.png")
    plt.close(fig)

    # --- Plot C: Residual vs force-temp predictor for each c ---
    fig, axes = plt.subplots(1, n_c, figsize=(8 * n_c, 6), sharey=True, squeeze=False)
    for i, c_val in enumerate(valid_c):
        ax = axes[0][i]
        v = df[df[f"actual_{c_val}"].notna()].copy()
        v["pe"] = v[f"projected_{c_val}"] - v[f"actual_{c_val}"]
        predictor = v["delta_t"].values * (v["force_n"].values - FREF) / FREF

        for stage_key, style in [("bw", {"marker": "o", "color": "tab:blue", "label": "BW"}),
                                  ("db", {"marker": "^", "color": "tab:orange", "label": "DB"})]:
            mask = v["stage"] == stage_key
            ax.scatter(predictor[mask], v["pe"].values[mask], marker=style["marker"],
                       c=style["color"], s=50, alpha=0.7,
                       edgecolors="black", linewidths=0.3, label=style["label"])

        # Fit line
        if len(predictor) >= 2:
            z = np.polyfit(predictor, v["pe"].values, 1)
            x_line = np.linspace(predictor.min(), predictor.max(), 50)
            ax.plot(x_line, np.polyval(z, x_line), "r-", lw=2, alpha=0.7,
                    label=f"slope={z[0]:.4f}")

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(0, color="gray", ls=":", lw=0.8)
        ax.set_xlabel(r"$\Delta T \times (F - 550) / 550$")
        if i == 0:
            ax.set_ylabel("Projection error (%)")
        ax.set_title(f"c = {c_val}")
        ax.legend(fontsize=8)

    fig.suptitle(
        f"Type {PLATE_TYPE} — Force-Temp Residual Pattern\n"
        f"Slope indicates implied k from NN nonlinearity",
        fontsize=13,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "comparison_residual_pattern.png"), dpi=150)
    print(f"Saved comparison_residual_pattern.png")
    plt.close(fig)


print("\nDone.")
