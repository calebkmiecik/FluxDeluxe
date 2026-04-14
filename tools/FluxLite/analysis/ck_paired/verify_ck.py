"""
Pipeline C+K Optimization
==========================
For each candidate c value processed through the real pipeline:
1. Load actual pipeline results (processed-on files)
2. Find optimal k from pipeline residuals (post-NN force-temp pattern)
3. Apply k post-correction and measure final error
4. Rank all (c, k) combinations

Usage: python verify_ck.py
  Edit C_VALUES below to match what's been processed in the app.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

# --- Configuration ---
# Usage: python verify_ck.py [plate_types...] [--c val1 val2 ...] [--exclude dev1 dev2 ...]
# Examples:
#   python verify_ck.py                          (defaults: Type 06)
#   python verify_ck.py 07 11                    (Type 07+11)
#   python verify_ck.py 07 11 --c 0.0016 0.0018 0.0020 0.0022 0.0024
#   python verify_ck.py 06 --exclude 06.00000025

# Parse args
args = sys.argv[1:]
plate_types = []
c_values_arg = []
exclude_arg = []
mode = "plates"
for a in args:
    if a == "--c":
        mode = "c"
        continue
    elif a == "--exclude":
        mode = "exclude"
        continue
    if mode == "plates":
        plate_types.append(a)
    elif mode == "c":
        c_values_arg.append(float(a))
    elif mode == "exclude":
        exclude_arg.append(a)

PLATE_TYPES = plate_types or ["06"]
EXCLUDE_DEVICES = set(exclude_arg) if exclude_arg else {"06.00000025"}
PLATE_LABEL = "+".join(PLATE_TYPES)

# Default c candidates per plate type group
DEFAULT_C = {
    "06": [0.0010, 0.0012, 0.0014, 0.0015, 0.0016, 0.0017, 0.0018, 0.0019, 0.0020],
    "07+11": [0.0014, 0.0016, 0.0018, 0.0020, 0.0022, 0.0024, 0.0025, 0.0026, 0.0028],
    "08+12": [0.0006, 0.0008, 0.0009, 0.0010, 0.0012, 0.0014],
}
C_VALUES = c_values_arg or DEFAULT_C.get(PLATE_LABEL, [0.0010, 0.0014, 0.0018, 0.0022, 0.0026])

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"output_{PLATE_LABEL}")
os.makedirs(OUT, exist_ok=True)

IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
FREF = float(getattr(config, "TEMP_POST_CORRECTION_FREF_N", 550.0))
BUCKET_SIZE = 5.0

print(f"Pipeline C+K optimization for plate types {PLATE_LABEL}")
print(f"Excluding: {EXCLUDE_DEVICES}")
print(f"C candidates: {C_VALUES}")
print()


# ===========================================================================
# 1. Collect all pipeline results
# ===========================================================================
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices
              if d.split(".", 1)[0] in PLATE_TYPES and d not in EXCLUDE_DEVICES]

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
print(f"{len(df)} test-stage points collected")
print()


# ===========================================================================
# 2. For each c: find optimal k from pipeline residuals, rank performance
# ===========================================================================
results = []

for c_val in C_VALUES:
    act_col = f"actual_{c_val}"
    v = df[df[act_col].notna()].copy()

    if len(v) < 5:
        print(f"  c={c_val}: only {len(v)} points, skipping")
        continue

    delta_t = v["delta_t"].values.astype(float)
    force = v["force_n"].values.astype(float)
    actual_error = v[act_col].values.astype(float)

    # Temperature-bucket weighting
    v["temp_bucket"] = (v["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bucket_counts = v.groupby("temp_bucket").size().to_dict()
    v["weight"] = v["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])
    w = v["weight"].values.astype(float)
    sw = np.sqrt(w)

    # --- c-only performance (no k) ---
    wmae_c_only = np.average(np.abs(actual_error), weights=w)

    # --- Find k from pipeline residuals ---
    # The pipeline has already applied c. The remaining error should be:
    #   actual_error ≈ plate_intercept + residual_c*deltaT + k_effect*deltaT*(F-Fref)/Fref + noise
    # We want per-plate intercepts + shared k.
    # Build design matrix: per-plate intercept dummies + deltaT*(F-Fref)/Fref
    devices = sorted(v["device_id"].unique())
    n_devs = len(devices)
    dev_to_idx = {d: i for i, d in enumerate(devices)}

    # Intercept dummies (one per plate)
    X_intercepts = np.zeros((len(v), n_devs))
    for j, dev in enumerate(devices):
        X_intercepts[v["device_id"].values == dev, j] = 1.0

    # k predictor
    k_pred = delta_t * (force - FREF) / FREF

    # Full model: plate intercepts + k term
    X_k = np.column_stack([X_intercepts, k_pred])
    Xw_k = X_k * sw[:, None]
    yw_k = actual_error * sw
    beta_k = np.linalg.lstsq(Xw_k, yw_k, rcond=None)[0]

    plate_intercepts = {dev: beta_k[i] for i, dev in enumerate(devices)}
    k_val = -beta_k[-1] / 100.0

    # Apply k post-correction
    after_k = actual_error + k_val * 100.0 * delta_t * (force - FREF) / FREF
    wmae_ck = np.average(np.abs(after_k), weights=w)

    # R2 of k term (how much variance k explains beyond plate intercepts)
    X_nok = X_intercepts
    beta_nok = np.linalg.lstsq((X_nok * sw[:, None]), yw_k, rcond=None)[0]
    pred_nok = X_nok @ beta_nok
    pred_k = X_k @ beta_k
    ss_res_nok = np.sum(w * (actual_error - pred_nok) ** 2)
    ss_res_k = np.sum(w * (actual_error - pred_k) ** 2)
    ss_tot = np.sum(w * (actual_error - np.average(actual_error, weights=w)) ** 2)
    r2_nok = 1.0 - ss_res_nok / ss_tot if ss_tot > 0 else 0.0
    r2_k = 1.0 - ss_res_k / ss_tot if ss_tot > 0 else 0.0

    # Also sweep k to find the minimum MAE (brute force validation)
    k_sweep = np.linspace(-0.002, 0.004, 601)
    sweep_maes = []
    for k_try in k_sweep:
        after_try = actual_error + k_try * 100.0 * delta_t * (force - FREF) / FREF
        sweep_maes.append(np.average(np.abs(after_try), weights=w))
    sweep_maes = np.array(sweep_maes)
    k_sweep_best = k_sweep[np.argmin(sweep_maes)]
    mae_sweep_best = sweep_maes.min()

    results.append({
        "c": c_val,
        "k_regression": k_val,
        "k_sweep": k_sweep_best,
        "n_points": len(v),
        "baseline_wmae": np.average(np.abs(v["baseline_error"].values), weights=w),
        "wmae_c_only": wmae_c_only,
        "wmae_ck_regression": wmae_ck,
        "wmae_ck_sweep": mae_sweep_best,  # weighted MAE at best k (matches sweep curve)
        "r2_intercepts_only": r2_nok,
        "r2_with_k": r2_k,
        "plate_intercepts": plate_intercepts,
        "k_sweep_data": (k_sweep, sweep_maes),
    })

    print(f"  c={c_val}: {len(v)} pts, "
          f"wMAE c-only={wmae_c_only:.3f}%, "
          f"k_regression={k_val:.6f}, k_sweep={k_sweep_best:.6f}, "
          f"wMAE c+k={wmae_ck:.3f}%, "
          f"R2 improvement from k: {r2_k - r2_nok:+.4f}")


# ===========================================================================
# 3. Ranking
# ===========================================================================
print()
print("=" * 80)
print("  RANKING: (c, k) combinations by actual pipeline performance")
print("=" * 80)
print()
print(f"  {'c':>8s}  {'k_regr':>10s}  {'k_sweep':>10s}  {'wMAE(c)':>9s}  {'wMAE(c+k)':>10s}  {'wMAE(sweep)':>12s}  {'baseline':>9s}  {'n':>4s}")
print(f"  {'':->8s}  {'':->10s}  {'':->10s}  {'':->9s}  {'':->10s}  {'':->12s}  {'':->9s}  {'':->4s}")

# Sort by weighted MAE after c+k (sweep best)
ranked = sorted(results, key=lambda r: r["wmae_ck_sweep"])
for r in ranked:
    print(f"  {r['c']:8.4f}  {r['k_regression']:+10.6f}  {r['k_sweep']:+10.6f}  "
          f"{r['wmae_c_only']:8.3f}%  {r['wmae_ck_regression']:9.3f}%  "
          f"{r['wmae_ck_sweep']:11.3f}%  {r['baseline_wmae']:8.2f}%  {r['n_points']:4d}")

print()
best = ranked[0]
print(f"  BEST: c={best['c']}, k={best['k_sweep']:.6f}, "
      f"pipeline wMAE={best['wmae_ck_sweep']:.3f}%")
print(f"  (baseline wMAE={best['baseline_wmae']:.2f}%, "
      f"reduction={100*(1-best['wmae_ck_sweep']/best['baseline_wmae']):.0f}%)")
print("=" * 80)

# Save
rdf = pd.DataFrame([{k: v for k, v in r.items()
                      if k not in ("plate_intercepts", "k_sweep_data")}
                     for r in results])
rdf.to_csv(os.path.join(OUT, "ck_ranking.csv"), index=False)
df.to_csv(os.path.join(OUT, "verify_ck_data.csv"), index=False)


# ===========================================================================
# 4. Plots
# ===========================================================================

# --- Plot A: k sweep curves for each c value ---
fig, ax = plt.subplots(figsize=(12, 7))
cmap = plt.cm.get_cmap("viridis")
colors = [cmap(i / max(len(results) - 1, 1)) for i in range(len(results))]

for i, r in enumerate(sorted(results, key=lambda x: x["c"])):
    k_sweep, sweep_maes = r["k_sweep_data"]
    ax.plot(k_sweep, sweep_maes, color=colors[i], lw=2, alpha=0.8,
            label=f"c={r['c']} (best k={r['k_sweep']:.5f}, MAE={r['wmae_ck_sweep']:.3f}%)")
    # Mark minimum
    ax.scatter([r["k_sweep"]], [r["wmae_ck_sweep"]], c=[colors[i]],
               s=100, zorder=5, edgecolors="black", linewidths=1)

ax.axvline(0, color="gray", ls=":", lw=0.8)
ax.set_xlabel("k value")
ax.set_ylabel("Weighted MAE (%)")
ax.set_title(f"Type {PLATE_LABEL} — k Sweep for Each c Value\nFind k that minimizes pipeline error")
ax.legend(fontsize=8, loc="upper right")
plt.tight_layout()
fig.savefig(os.path.join(OUT, "k_sweep_curves.png"), dpi=150)
print(f"\nSaved k_sweep_curves.png")
plt.close(fig)

# --- Plot B: MAE landscape (c vs k_optimal vs MAE) ---
fig, axes = plt.subplots(1, 2, figsize=(14, 6))

c_list = [r["c"] for r in sorted(results, key=lambda x: x["c"])]
wmae_c_only_list = [r["wmae_c_only"] for r in sorted(results, key=lambda x: x["c"])]
wmae_ck_list = [r["wmae_ck_sweep"] for r in sorted(results, key=lambda x: x["c"])]
k_list = [r["k_sweep"] for r in sorted(results, key=lambda x: x["c"])]

ax = axes[0]
ax.plot(c_list, wmae_c_only_list, "o-", color="tab:blue", lw=2, markersize=8, label="c only")
ax.plot(c_list, wmae_ck_list, "s-", color="tab:green", lw=2, markersize=8, label="c + optimal k")
ax.set_xlabel("c value")
ax.set_ylabel("Pipeline wMAE (%)")
ax.set_title("Pipeline Error vs c Value (weighted)")
ax.legend(fontsize=10)
ax.grid(True, alpha=0.3)

ax = axes[1]
ax.plot(c_list, k_list, "D-", color="tab:red", lw=2, markersize=8)
ax.axhline(0, color="gray", ls=":", lw=0.8)
ax.set_xlabel("c value")
ax.set_ylabel("Optimal k value")
ax.set_title("Optimal k for Each c")
ax.grid(True, alpha=0.3)

fig.suptitle(f"Type {PLATE_LABEL} — C+K Pipeline Optimization", fontsize=13)
plt.tight_layout()
fig.savefig(os.path.join(OUT, "ck_landscape.png"), dpi=150)
print(f"Saved ck_landscape.png")
plt.close(fig)

# --- Plot C: Best (c,k) — actual pipeline errors ---
if best:
    c_best = best["c"]
    k_best = best["k_sweep"]
    act_col = f"actual_{c_best}"
    v = df[df[act_col].notna()].copy()
    delta_t = v["delta_t"].values.astype(float)
    force = v["force_n"].values.astype(float)
    actual = v[act_col].values.astype(float)
    after_k = actual + k_best * 100.0 * delta_t * (force - FREF) / FREF
    v["after_k"] = after_k
    v["temp_bucket"] = (v["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    _bc = v.groupby("temp_bucket").size().to_dict()
    v["weight"] = v["temp_bucket"].map(lambda b: 1.0 / _bc[b])

    fig, axes = plt.subplots(1, 3, figsize=(20, 6), sharey=True)
    for ax, col, title, data_col in [
        (axes[0], "baseline_error", "No correction", "baseline_error"),
        (axes[1], act_col, f"After c={c_best} (pipeline)", act_col),
        (axes[2], "after_k", f"After c={c_best} + k={k_best:.5f}", "after_k"),
    ]:
        for stage_key, style in [("bw", {"marker": "o", "color": "tab:blue", "label": "BW"}),
                                  ("db", {"marker": "^", "color": "tab:orange", "label": "DB"})]:
            s = v[v["stage"] == stage_key]
            ax.scatter(s["temp_f"], s[data_col], marker=style["marker"],
                       c=style["color"], s=50, alpha=0.7,
                       edgecolors="black", linewidths=0.3, label=style["label"])
            if len(s) >= 2:
                z = np.polyfit(s["temp_f"].values, s[data_col].values, 1)
                x_line = np.linspace(s["temp_f"].min(), s["temp_f"].max(), 50)
                ax.plot(x_line, np.polyval(z, x_line), color=style["color"],
                        ls="--", lw=1.5, alpha=0.5)

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel("Temperature (F)")
        ax.set_ylabel("Signed error (%)")
        # Use weighted MAE for plot titles
        _v_w = v["weight"].values if "weight" in v.columns else np.ones(len(v))
        wmae = np.average(np.abs(v[data_col].values), weights=_v_w)
        ax.set_title(f"{title}\nwMAE = {wmae:.2f}%")
        ax.legend(fontsize=8)

    fig.suptitle(
        f"Type {PLATE_LABEL} — Best Pipeline Result: c={c_best}, k={k_best:.6f}\n"
        f"Baseline {best['baseline_wmae']:.2f}% → c only {best['wmae_c_only']:.2f}% → c+k {best['wmae_ck_sweep']:.2f}%",
        fontsize=13,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "best_ck_result.png"), dpi=150)
    print(f"Saved best_ck_result.png")
    plt.close(fig)


print("\nDone.")
