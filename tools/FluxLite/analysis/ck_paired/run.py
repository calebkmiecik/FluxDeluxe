"""
C+K Paired Difference Analysis
================================
Derives k from paired BW/DB measurements within the same test session,
then derives c per-plate with k already known.

Key insight: every test session measures BW and DB at the exact same
temperature, on the same plate, at the same moment.  The difference in
error isolates force-dependent effects — temperature drift (c) and
plate manufacturing cancel out in the subtraction.

Stage 1 — Find k from paired BW-DB differences:
  delta_error = a + b1*(F_bw - F_db)/550 + b2*deltaT*(F_bw - F_db)/550
  - a:  constant BW-DB offset
  - b1: force-dependent baseline (NN nonlinearity, not thermal)
  - b2: force-dependent thermal drift → k = -b2/100

Stage 2 — Find c per plate with k known:
  Subtract k's contribution from all data, then fit per-plate:
  error_adjusted = beta0 + beta1*deltaT  → c = -beta1/100

Outputs (in output/):
  - regression_results.txt   -- full report
  - paired_data.csv          -- one row per test session (BW/DB pair)
  - data.csv                 -- all test-stage data points
  - coefficients.csv         -- shared k, per-plate c, averaged c
  - k_paired_scatter.png     -- delta_error vs k predictor (THE k plot)
  - per_plate_panels.png     -- per-plate before/after (BW/DB distinct)
  - slope_overlay.png        -- all plates overlaid, intercepts zeroed
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

# --- Configuration ---
# Plate types to include (e.g. ["06"] or ["07", "11"] for same-size group)
# Override via command line: python run.py 07 11
PLATE_TYPES = sys.argv[1:] if len(sys.argv) > 1 else ["06"]
EXCLUDE_DEVICES: set[str] = {"06.00000025"}  # known damaged devices

PLATE_LABEL = "+".join(PLATE_TYPES)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"output_{PLATE_LABEL}")
os.makedirs(OUT, exist_ok=True)

IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))
FREF = float(getattr(config, "TEMP_POST_CORRECTION_FREF_N", 550.0))
BUCKET_SIZE = 5.0

STAGE_STYLES = {
    "bw": {"marker": "o", "color": "tab:blue", "label": "Body Weight"},
    "db": {"marker": "^", "color": "tab:orange", "label": "Dumbbell"},
}


# ===========================================================================
# 1. Collect per-test-stage data (no bias correction)
# ===========================================================================
all_devices = repo.list_temperature_devices() or []
pt_devices = [d for d in all_devices
              if d.split(".", 1)[0] in PLATE_TYPES and d not in EXCLUDE_DEVICES]
print(f"Plate types {PLATE_LABEL}: {len(pt_devices)} devices — {pt_devices}")

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
                "is_excluded": dev in EXCLUDE_DEVICES,
            })

df = pd.DataFrame(rows)
print(f"{len(df)} total test-stage data points across {len(pt_devices)} devices")


# ===========================================================================
# 2. Build paired BW/DB data (one row per test session)
# ===========================================================================
paired_rows = []
for (dev, csv), grp in df.groupby(["device_id", "raw_csv"]):
    bw = grp[grp["stage"] == "bw"]
    db = grp[grp["stage"] == "db"]
    if bw.empty or db.empty:
        continue

    bw_row = bw.iloc[0]
    db_row = db.iloc[0]

    paired_rows.append({
        "device_id": dev,
        "raw_csv": csv,
        "temp_f": bw_row["temp_f"],
        "delta_t": bw_row["delta_t"],
        "force_bw": bw_row["force_n"],
        "force_db": db_row["force_n"],
        "error_bw": bw_row["avg_signed_pct"],
        "error_db": db_row["avg_signed_pct"],
        "delta_error": bw_row["avg_signed_pct"] - db_row["avg_signed_pct"],
        "force_diff": bw_row["force_n"] - db_row["force_n"],
        "is_excluded": dev in EXCLUDE_DEVICES,
    })

pdf = pd.DataFrame(paired_rows)
pdf["force_ratio"] = pdf["force_diff"] / FREF
pdf["k_predictor"] = pdf["delta_t"] * pdf["force_ratio"]
print(f"{len(pdf)} paired test sessions")


# ===========================================================================
# 3. Stage 1: Find k from paired differences
# ===========================================================================
def find_k(sdf, label):
    """Fit k from paired BW-DB differences.  Returns (k, b1, report_lines)."""
    sdf = sdf.copy()
    lines = []
    lines.append(f"{'='*60}")
    lines.append(f"  STAGE 1: k from paired differences — {label}")
    lines.append(f"{'='*60}")
    lines.append(f"  {len(sdf)} paired tests")

    # Temperature-bucket weighting
    sdf["temp_bucket"] = (sdf["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bucket_counts = sdf.groupby("temp_bucket").size().to_dict()
    sdf["weight"] = sdf["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])

    lines.append("")
    lines.append(f"  Temp buckets ({BUCKET_SIZE:.0f}F):")
    for bucket in sorted(bucket_counts.keys()):
        n = bucket_counts[bucket]
        bucket_data = sdf[sdf["temp_bucket"] == bucket]
        avg_de = bucket_data["delta_error"].mean()
        lines.append(f"    {bucket:+6.1f}F: n={n:2d}, avg delta_error={avg_de:+.2f}%, weight={1.0/n:.3f}")

    y = sdf["delta_error"].values.astype(float)
    w = sdf["weight"].values.astype(float)

    # Model: delta_error = a + b1*(F_bw-F_db)/550 + b2*deltaT*(F_bw-F_db)/550
    X_intercept = np.ones(len(sdf))
    X_force = sdf["force_ratio"].values.astype(float)
    X_k = sdf["k_predictor"].values.astype(float)
    X = np.column_stack([X_intercept, X_force, X_k])

    sw = np.sqrt(w)
    Xw = X * sw[:, None]
    yw = y * sw

    beta = np.linalg.lstsq(Xw, yw, rcond=None)[0]
    a_val = beta[0]
    b1_val = beta[1]
    k_val = -beta[2] / 100.0

    # R2
    y_pred = X @ beta
    ss_res = np.sum(w * (y - y_pred) ** 2)
    ss_tot = np.sum(w * (y - np.average(y, weights=w)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # Also fit without k (a + b1 only) to see if k adds anything
    X_nok = np.column_stack([X_intercept, X_force])
    beta_nok = np.linalg.lstsq((X_nok * sw[:, None]), yw, rcond=None)[0]
    y_pred_nok = X_nok @ beta_nok
    ss_res_nok = np.sum(w * (y - y_pred_nok) ** 2)
    r2_nok = 1.0 - ss_res_nok / ss_tot if ss_tot > 0 else 0.0

    # Also fit simplest model (a only)
    beta_a = np.linalg.lstsq((X_intercept * sw).reshape(-1, 1), yw, rcond=None)[0]
    y_pred_a = X_intercept * beta_a[0]
    ss_res_a = np.sum(w * (y - y_pred_a) ** 2)
    r2_a = 1.0 - ss_res_a / ss_tot if ss_tot > 0 else 0.0

    lines.append("")
    lines.append(f"  Full model (a + b1*force_ratio + b2*deltaT*force_ratio):")
    lines.append(f"    a  (constant BW-DB offset)       = {a_val:+.4f}%")
    lines.append(f"    b1 (force-dependent baseline)     = {b1_val:+.4f}")
    lines.append(f"    b2 (force-dependent thermal)      = {beta[2]:+.4f}")
    lines.append(f"    k  = -b2/100                      = {k_val:.6f}")
    lines.append(f"    wR2                               = {r2:.4f}")
    lines.append("")
    lines.append(f"  Without k (a + b1*force_ratio only):")
    lines.append(f"    wR2                               = {r2_nok:.4f}")
    lines.append(f"  Constant only (a):")
    lines.append(f"    wR2                               = {r2_a:.4f}")
    lines.append(f"  R2 improvement from k:                {r2 - r2_nok:+.4f}")
    lines.append(f"  R2 improvement from b1:               {r2_nok - r2_a:+.4f}")

    # Force spread summary
    lines.append("")
    lines.append(f"  Force spread:")
    lines.append(f"    BW range: {sdf['force_bw'].min():.0f} - {sdf['force_bw'].max():.0f} N")
    lines.append(f"    DB range: {sdf['force_db'].min():.0f} - {sdf['force_db'].max():.0f} N")
    lines.append(f"    Force diff range: {sdf['force_diff'].min():.0f} - {sdf['force_diff'].max():.0f} N")
    lines.append(f"{'='*60}")

    return k_val, b1_val, a_val, beta, "\n".join(lines), sdf


# Run on clean plates only
pdf_clean = pdf[~pdf["is_excluded"]].copy()
k_val, b1_val, a_val, k_beta, k_report, pdf_fitted = find_k(pdf_clean, f"Excluding {EXCLUDE_DEVICES}" if EXCLUDE_DEVICES else "All plates")
print("\n" + k_report)


# ===========================================================================
# 4. Stage 2: Find c per plate with k known
# ===========================================================================
def find_c_per_plate(all_df, k, results_label):
    """Fit c per plate after subtracting k's contribution."""
    all_df = all_df.copy()
    lines = []
    lines.append(f"{'='*60}")
    lines.append(f"  STAGE 2: c per plate (k = {k:.6f} fixed) — {results_label}")
    lines.append(f"{'='*60}")

    # Subtract k's contribution
    delta_t = all_df["delta_t"].values.astype(float)
    force = all_df["force_n"].values.astype(float)
    all_df["error_adjusted"] = all_df["avg_signed_pct"] + delta_t * k * 100.0 * (force - FREF) / FREF

    plate_results = []
    clean_devs = sorted(all_df["device_id"].unique())

    for dev in clean_devs:
        plate_df = all_df[all_df["device_id"] == dev].copy()
        n_points = len(plate_df)
        if n_points < 3:
            lines.append(f"\n  {dev}: only {n_points} points, skipped")
            continue

        # Temperature-bucket weights
        plate_df["temp_bucket"] = (plate_df["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
        bucket_counts = plate_df.groupby("temp_bucket").size().to_dict()
        plate_df["weight"] = plate_df["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])

        dt = plate_df["delta_t"].values.astype(float)
        y = plate_df["error_adjusted"].values.astype(float)
        w = plate_df["weight"].values.astype(float)

        # error_adjusted = beta0 + beta1*deltaT
        X = np.column_stack([np.ones_like(dt), dt])
        sw = np.sqrt(w)
        beta = np.linalg.lstsq((X * sw[:, None]), y * sw, rcond=None)[0]
        intercept = beta[0]
        c_val = -beta[1] / 100.0

        # R2
        y_pred = X @ beta
        ss_res = np.sum(w * (y - y_pred) ** 2)
        ss_tot = np.sum(w * (y - np.average(y, weights=w)) ** 2)
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

        # Correction quality on original data
        orig_y = plate_df["avg_signed_pct"].values.astype(float)
        f = plate_df["force_n"].values.astype(float)
        corrected_c = orig_y + dt * c_val * 100.0
        corrected_ck = orig_y + (dt * c_val + dt * k * (f - FREF) / FREF) * 100.0

        plate_results.append({
            "device_id": dev,
            "n_points": n_points,
            "n_buckets": len(bucket_counts),
            "temp_min_f": plate_df["temp_f"].min(),
            "temp_max_f": plate_df["temp_f"].max(),
            "temp_range_f": plate_df["temp_f"].max() - plate_df["temp_f"].min(),
            "intercept": intercept,
            "c": c_val,
            "r2": r2,
            "mean_abs_before": np.mean(np.abs(orig_y)),
            "mean_abs_after_c": np.mean(np.abs(corrected_c)),
            "mean_abs_after_ck": np.mean(np.abs(corrected_ck)),
        })

        lines.append(f"\n  {dev}:")
        lines.append(f"    n={n_points}, temp={plate_df['temp_f'].min():.0f}-{plate_df['temp_f'].max():.0f}F "
                      f"({len(bucket_counts)} buckets)")
        lines.append(f"    intercept = {intercept:+.2f}%")
        lines.append(f"    c = {c_val:.6f}")
        lines.append(f"    wR2 = {r2:.4f}")
        lines.append(f"    |error|: {np.mean(np.abs(orig_y)):.2f}% "
                      f"-> c: {np.mean(np.abs(corrected_c)):.2f}% "
                      f"-> c+k: {np.mean(np.abs(corrected_ck)):.2f}%")

    if plate_results:
        c_vals = np.array([r["c"] for r in plate_results])
        avg_c = np.mean(c_vals)
        std_c = np.std(c_vals, ddof=1) if len(c_vals) > 1 else 0.0

        lines.append(f"\n  Averaged c across {len(plate_results)} plates:")
        lines.append(f"    c = {avg_c:.6f}  (std = {std_c:.6f})")

        # Apply averaged c + shared k to all data
        all_y = all_df["avg_signed_pct"].values.astype(float)
        all_dt = all_df["delta_t"].values.astype(float)
        all_f = all_df["force_n"].values.astype(float)
        all_c = all_y + all_dt * avg_c * 100.0
        all_ck = all_y + (all_dt * avg_c + all_dt * k * (all_f - FREF) / FREF) * 100.0

        lines.append(f"\n  Averaged correction applied to all {len(all_df)} points:")
        lines.append(f"    |error|: {np.mean(np.abs(all_y)):.2f}% "
                      f"-> c: {np.mean(np.abs(all_c)):.2f}% "
                      f"-> c+k: {np.mean(np.abs(all_ck)):.2f}%")
    else:
        avg_c = 0.0
        std_c = 0.0

    lines.append(f"{'='*60}")
    return plate_results, avg_c, std_c, "\n".join(lines)


df_clean = df[~df["is_excluded"]].copy()
plate_results, avg_c, std_c, c_report = find_c_per_plate(df_clean, k_val, f"Excluding {EXCLUDE_DEVICES}" if EXCLUDE_DEVICES else "All plates")
print("\n" + c_report)


# ===========================================================================
# 5. Save data files
# ===========================================================================
pdf_clean.to_csv(os.path.join(OUT, "paired_data.csv"), index=False)
df.to_csv(os.path.join(OUT, "data.csv"), index=False)

coef_rows = [{"parameter": "k", "value": k_val, "source": "paired BW-DB regression"}]
for r in plate_results:
    coef_rows.append({"parameter": "c", "value": r["c"], "source": f"per-plate {r['device_id']}"})
coef_rows.append({"parameter": "c_avg", "value": avg_c, "source": f"mean of {len(plate_results)} plates"})
coef_rows.append({"parameter": "c_std", "value": std_c, "source": f"std of {len(plate_results)} plates"})
pd.DataFrame(coef_rows).to_csv(os.path.join(OUT, "coefficients.csv"), index=False)

full_report = k_report + "\n\n" + c_report
with open(os.path.join(OUT, "regression_results.txt"), "w") as f:
    f.write(full_report)
print(f"\nSaved regression_results.txt, paired_data.csv, data.csv, coefficients.csv")


# ===========================================================================
# 6. Plot: k paired scatter (THE key plot)
# ===========================================================================
cmap = plt.cm.get_cmap("tab10")
plate_colors = {}
clean_devs = sorted(pdf_clean["device_id"].unique())
for idx, dev in enumerate(clean_devs):
    plate_colors[dev] = cmap(idx)

fig, ax = plt.subplots(figsize=(10, 7))

for dev in clean_devs:
    plate = pdf_fitted[pdf_fitted["device_id"] == dev]
    short = dev.split(".")[-1][-4:]
    ax.scatter(
        plate["k_predictor"], plate["delta_error"],
        c=[plate_colors[dev]], s=60, alpha=0.8,
        edgecolors="black", linewidths=0.5, label=short,
    )

# Fit line from the regression (b2 slope through the data)
x_range = np.linspace(pdf_fitted["k_predictor"].min(), pdf_fitted["k_predictor"].max(), 50)
# Full model prediction at mean force_ratio
mean_fr = pdf_fitted["force_ratio"].mean()
y_fit = a_val + b1_val * mean_fr + k_beta[2] * x_range
ax.plot(x_range, y_fit, "r-", lw=2, alpha=0.8,
        label=f"k = {k_val:.6f}")

# Zero line
ax.axhline(0, color="gray", ls=":", lw=0.8)
ax.axvline(0, color="gray", ls=":", lw=0.8)

ax.set_xlabel(r"$\Delta T \times (F_{BW} - F_{DB}) \,/\, 550$", fontsize=12)
ax.set_ylabel("BW error - DB error (%)", fontsize=12)
ax.set_title(
    f"Type {PLATE_LABEL} — Paired BW-DB Difference vs Temperature-Force Predictor\n"
    f"k = {k_val:.6f} (excl. {EXCLUDE_DEVICES})",
    fontsize=12,
)
ax.legend(fontsize=9)
plt.tight_layout()
fig.savefig(os.path.join(OUT, "k_paired_scatter.png"), dpi=150)
print("Saved k_paired_scatter.png")
plt.close(fig)


# ===========================================================================
# 7. Plot: per-plate panels (BW/DB distinct)
#    3 columns: no correction / after c only / after c + k
# ===========================================================================
n_plates = len(plate_results)
if n_plates > 0:
    fig, axes = plt.subplots(n_plates, 3, figsize=(18, 4.5 * n_plates), squeeze=False)

    for i, r in enumerate(plate_results):
        dev = r["device_id"]
        plate_df = df_clean[df_clean["device_id"] == dev].copy()
        c_val_plate = r["c"]

        dt = plate_df["delta_t"].values.astype(float)
        f = plate_df["force_n"].values.astype(float)
        y = plate_df["avg_signed_pct"].values.astype(float)

        plate_df["corrected_c"] = y + dt * c_val_plate * 100.0
        plate_df["corrected_ck"] = y + (dt * c_val_plate + dt * k_val * (f - FREF) / FREF) * 100.0

        for j, (col, title) in enumerate([
            ("avg_signed_pct", "No correction"),
            ("corrected_c", f"After c = {c_val_plate:.5f}"),
            ("corrected_ck", f"After c = {c_val_plate:.5f}, k = {k_val:.6f}"),
        ]):
            ax = axes[i][j]
            for stage_key, style in STAGE_STYLES.items():
                stage_data = plate_df[plate_df["stage"] == stage_key]
                if stage_data.empty:
                    continue
                ax.scatter(
                    stage_data["temp_f"], stage_data[col],
                    marker=style["marker"], c=style["color"],
                    s=60, alpha=0.8, label=style["label"],
                    edgecolors="black", linewidths=0.5,
                )
                if len(stage_data) >= 2:
                    x = stage_data["temp_f"].values.astype(float)
                    yv = stage_data[col].values.astype(float)
                    z = np.polyfit(x, yv, 1)
                    x_line = np.linspace(x.min(), x.max(), 50)
                    ax.plot(x_line, np.polyval(z, x_line),
                            color=style["color"], ls="--", lw=1.5, alpha=0.5)

            ax.axhline(0, color="gray", ls=":", lw=0.8)
            ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
            ax.set_xlabel("Temperature (F)")
            if j == 0:
                ax.set_ylabel(f"{dev}\nSigned error (%)")
            ax.set_title(title)
            if i == 0:
                ax.legend(fontsize=8)

    fig.suptitle(
        f"Type {PLATE_LABEL} — Per-Plate Results (excl. {EXCLUDE_DEVICES})\n"
        f"c per plate, shared k = {k_val:.6f}",
        fontsize=13,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "per_plate_panels.png"), dpi=150)
    print("Saved per_plate_panels.png")
    plt.close(fig)


# ===========================================================================
# 8. Plot: slope overlay — all plates, intercepts zeroed, averaged c + shared k
# ===========================================================================
if plate_results:
    intercepts = {r["device_id"]: r["intercept"] for r in plate_results}
    cdf = df_clean.copy()
    cdf["zeroed"] = cdf["avg_signed_pct"] - cdf["device_id"].map(intercepts)

    dt = cdf["delta_t"].values.astype(float)
    f = cdf["force_n"].values.astype(float)
    y_z = cdf["zeroed"].values.astype(float)

    cdf["zeroed_after_c"] = y_z + dt * avg_c * 100.0
    cdf["zeroed_after_ck"] = y_z + (dt * avg_c + dt * k_val * (f - FREF) / FREF) * 100.0

    fig, axes = plt.subplots(1, 3, figsize=(20, 6), sharey=True)
    for ax, col, title in [
        (axes[0], "zeroed", "No correction"),
        (axes[1], "zeroed_after_c", f"After avg c = {avg_c:.5f}"),
        (axes[2], "zeroed_after_ck", f"After avg c = {avg_c:.5f}, k = {k_val:.6f}"),
    ]:
        for dev in sorted(intercepts.keys()):
            plate = cdf[cdf["device_id"] == dev]
            color = plate_colors[dev]
            short = dev.split(".")[-1][-4:]

            for stage_key, style in STAGE_STYLES.items():
                stage_data = plate[plate["stage"] == stage_key]
                if stage_data.empty:
                    continue
                label = f"{short} {style['label']}" if ax == axes[0] else None
                ax.scatter(
                    stage_data["temp_f"], stage_data[col],
                    marker=style["marker"], c=[color],
                    s=50, alpha=0.7, label=label,
                    edgecolors="black", linewidths=0.3,
                )

            # One trend line per plate
            if len(plate) >= 2:
                x = plate["temp_f"].values.astype(float)
                yv = plate[col].values.astype(float)
                z = np.polyfit(x, yv, 1)
                x_line = np.linspace(x.min(), x.max(), 50)
                ax.plot(x_line, np.polyval(z, x_line),
                        color=color, ls="-", lw=2, alpha=0.6)

        ax.axhline(0, color="gray", ls=":", lw=0.8)
        ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
        ax.set_xlabel("Temperature (F)")
        ax.set_ylabel("Signed error (%, intercept zeroed)")
        ax.set_title(title)
        if ax == axes[0]:
            ax.legend(fontsize=6, ncol=2, loc="upper left")

    fig.suptitle(
        f"Type {PLATE_LABEL} — Slope Overlay (excl. {EXCLUDE_DEVICES})\n"
        f"Per-plate intercepts removed. Averaged c = {avg_c:.6f} (std {std_c:.6f}), "
        f"shared k = {k_val:.6f}",
        fontsize=12,
    )
    plt.tight_layout()
    fig.savefig(os.path.join(OUT, "slope_overlay.png"), dpi=150)
    print("Saved slope_overlay.png")
    plt.close(fig)


print("\nDone. Check output/ for results.")
