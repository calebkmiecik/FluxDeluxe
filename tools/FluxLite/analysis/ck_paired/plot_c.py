"""
Plot pipeline results for a specific c value.

Usage: python plot_c.py 0.0015
       python plot_c.py 0.0014 0.0016
       python plot_c.py --plates 07 11 -- 0.0018 0.0020
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
FREF = float(getattr(config, "TEMP_POST_CORRECTION_FREF_N", 550.0))
BUCKET_SIZE = 5.0

# Parse args: --plates 07 11 -- 0.0018 0.0020  OR  just 0.0015
args = sys.argv[1:]
plate_types = []
exclude_devs = []
c_args = []
fref_arg = None
deadzone_arg = None  # (lo, hi) — k has no effect inside this force range
k_fixed = None  # override k sweep with a specific value
mode = "c"
for a in args:
    if a == "--plates":
        mode = "plates"
        continue
    elif a == "--exclude":
        mode = "exclude"
        continue
    elif a == "--fref":
        mode = "fref"
        continue
    elif a == "--deadzone":
        mode = "deadzone"
        deadzone_arg = []
        continue
    elif a == "--k":
        mode = "k_fixed"
        continue
    elif a == "--":
        mode = "c"
        continue
    if mode == "plates":
        plate_types.append(a)
    elif mode == "exclude":
        exclude_devs.append(a)
    elif mode == "fref":
        fref_arg = float(a)
        mode = "c"
    elif mode == "deadzone":
        deadzone_arg.append(float(a))
        if len(deadzone_arg) == 2:
            mode = "c"
    elif mode == "k_fixed":
        k_fixed = float(a)
        mode = "c"
    elif mode == "c":
        c_args.append(a)

PLATE_TYPES = plate_types or ["06"]
EXCLUDE_DEVICES = set(exclude_devs) if exclude_devs else {"06.00000025"}
PLATE_LABEL = "+".join(PLATE_TYPES)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"output_{PLATE_LABEL}")
os.makedirs(OUT, exist_ok=True)

if fref_arg is not None:
    FREF = fref_arg
    print(f"Using custom FREF = {FREF}")

DEADZONE = None
if deadzone_arg and len(deadzone_arg) == 2:
    DEADZONE = (deadzone_arg[0], deadzone_arg[1])
    print(f"Using deadzone: {DEADZONE[0]:.0f}-{DEADZONE[1]:.0f}N (k=0 inside)")


def k_force_ratio(force_arr):
    """Compute the force ratio for k correction, respecting deadzone if set."""
    f = np.asarray(force_arr, dtype=float)
    if DEADZONE is None:
        return (f - FREF) / FREF
    lo, hi = DEADZONE
    ratio = np.zeros_like(f)
    below = f < lo
    above = f > hi
    ratio[below] = (f[below] - lo) / FREF
    ratio[above] = (f[above] - hi) / FREF
    return ratio


if not c_args:
    print("Usage: python plot_c.py [--plates 07 11] [--fref 700] [--deadzone 400 700] [--] <c_value>")
    print("Example: python plot_c.py 0.0015")
    print("Example: python plot_c.py --plates 08 12 --deadzone 400 700 -- 0.0010")
    sys.exit(1)

C_VALUES = [float(x) for x in c_args]

# ===========================================================================
# 1. Collect data
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

        baseline_path = ""
        for r in proc_runs:
            if r.get("is_baseline") and not baseline_path:
                baseline_path = str(r.get("path") or "")
        if not (baseline_path and os.path.isfile(baseline_path)):
            continue

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

        baseline_result = analyzer.analyze_single_processed_csv(baseline_path, meta)
        baseline_stages = (baseline_result.get("data") or {}).get("stages") or {}

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
            row = {
                "device_id": dev,
                "temp_f": temp_f,
                "delta_t": delta_t,
                "stage": stage_key,
                "force_n": float(bl_stage.get("target_n", 0)),
                "baseline_error": sum(bl_errors) / len(bl_errors),
            }
            for c_val in C_VALUES:
                actual = None
                sel_stages = selected_stages_by_c.get(c_val, {})
                sel_cells = sel_stages.get(stage_key, {}).get("cells") or []
                if sel_cells:
                    sel_errors = [(float(c.get("mean_n", 0.0)) - target_n) / target_n * 100.0
                                  for c in sel_cells]
                    actual = sum(sel_errors) / len(sel_errors)
                row[f"actual_{c_val}"] = actual
            rows.append(row)

df = pd.DataFrame(rows)

# ===========================================================================
# 2. For each c: compute weights, find k, generate plot
# ===========================================================================
for c_val in C_VALUES:
    act_col = f"actual_{c_val}"
    v = df[df[act_col].notna()].copy()
    if v.empty:
        print(f"c={c_val}: no pipeline results found!")
        continue

    delta_t = v["delta_t"].values.astype(float)
    force = v["force_n"].values.astype(float)
    actual = v[act_col].values.astype(float)

    v["temp_bucket"] = (v["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bc = v.groupby("temp_bucket").size().to_dict()
    v["weight"] = v["temp_bucket"].map(lambda b: 1.0 / bc[b])
    w = v["weight"].values.astype(float)

    wmae_baseline = np.average(np.abs(v["baseline_error"].values), weights=w)
    wmae_c = np.average(np.abs(actual), weights=w)

    # Sweep k (or use fixed k)
    fr = k_force_ratio(force)
    if k_fixed is not None:
        best_k = k_fixed
        after_k = actual + best_k * 100.0 * delta_t * fr
        best_wmae = np.average(np.abs(after_k), weights=w)
    else:
        k_sweep = np.linspace(-0.002, 0.004, 601)
        best_k = 0.0
        best_wmae = wmae_c
        for k_try in k_sweep:
            after = actual + k_try * 100.0 * delta_t * fr
            wm = np.average(np.abs(after), weights=w)
            if wm < best_wmae:
                best_wmae = wm
                best_k = k_try
        after_k = actual + best_k * 100.0 * delta_t * fr
    v["after_k"] = after_k

    print(f"c={c_val}: wMAE baseline={wmae_baseline:.3f}%, "
          f"c-only={wmae_c:.3f}%, best k={best_k:.6f}, c+k={best_wmae:.3f}%")

    # --- Per-plate breakdown ---
    print(f"  Per-plate (c-only):")
    for dev in sorted(v["device_id"].unique()):
        dv = v[v["device_id"] == dev]
        dw = dv["weight"].values
        bl_wmae = np.average(np.abs(dv["baseline_error"].values), weights=dw)
        c_wmae = np.average(np.abs(dv[act_col].values), weights=dw)
        ck_wmae = np.average(np.abs(dv["after_k"].values), weights=dw)
        n = len(dv)
        temp_range = f"{dv['temp_f'].min():.0f}-{dv['temp_f'].max():.0f}F"
        print(f"    {dev}: n={n:2d}, {temp_range:>12s}, "
              f"baseline={bl_wmae:.2f}%, c={c_wmae:.2f}%, c+k={ck_wmae:.2f}%")

    # --- Force bands ---
    FORCE_BANDS = [
        ("DB 100-300N",  100,  300, "tab:orange", "^"),
        ("BW 500-700N",  500,  700, "tab:green",  "o"),
        ("BW 700-900N",  700,  900, "tab:blue",   "s"),
        ("BW 900-1100N", 900, 1100, "tab:red",    "D"),
        ("BW 1100N+",   1100, 9999, "tab:purple",  "P"),
    ]

    # --- Plot ---
    fig, axes = plt.subplots(1, 3, figsize=(20, 6), sharey=True)
    for ax, title, data_col in [
        (axes[0], "No correction", "baseline_error"),
        (axes[1], f"After c = {c_val}", act_col),
        (axes[2], f"After c = {c_val}, k = {best_k:.6f}", "after_k"),
    ]:
        for band_label, flo, fhi, color, marker in FORCE_BANDS:
            band = v[(v["force_n"] >= flo) & (v["force_n"] < fhi)]
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
        ax.set_xlabel("Temperature (F)")
        ax.set_ylabel("Signed error (%)")
        _w = v["weight"].values
        wmae = np.average(np.abs(v[data_col].values), weights=_w)
        ax.set_title(f"{title}\nwMAE = {wmae:.3f}%")
        ax.legend(fontsize=7, loc="best")

    fig.suptitle(
        f"Type {PLATE_LABEL} — c = {c_val}\n"
        f"Baseline {wmae_baseline:.3f}% → c only {wmae_c:.3f}% → c+k {best_wmae:.3f}%",
        fontsize=13,
    )
    plt.tight_layout()
    fref_tag = f"_fref{int(FREF)}" if fref_arg is not None else ""
    dz_tag = f"_deadzone{int(DEADZONE[0])}-{int(DEADZONE[1])}" if DEADZONE else ""
    k_tag = f"_k{best_k:.4f}" if k_fixed is not None else ""
    fname = f"plot_c{c_val}{fref_tag}{dz_tag}{k_tag}.png"
    fig.savefig(os.path.join(OUT, fname), dpi=150)
    print(f"Saved {fname}")
    plt.close(fig)

print("\nDone.")
