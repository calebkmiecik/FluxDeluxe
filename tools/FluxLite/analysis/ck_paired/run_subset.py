"""Subset analysis: plates 40, 42, 43 only — with plots."""
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os

OUT = os.path.join(os.path.dirname(__file__), "output")
pdf = pd.read_csv(os.path.join(OUT, "paired_data.csv"))
df = pd.read_csv(os.path.join(OUT, "data.csv"))

FREF = 550.0
BUCKET_SIZE = 5.0
IDEAL_TEMP_F = 76.0

KEEP = ["06.00000040", "06.00000042", "06.00000043"]
pdf = pdf[pdf["device_id"].isin(KEEP)].copy()
df = df[df["device_id"].isin(KEEP)].copy()

STAGE_STYLES = {
    "bw": {"marker": "o", "color": "tab:blue", "label": "Body Weight"},
    "db": {"marker": "^", "color": "tab:orange", "label": "Dumbbell"},
}

cmap = plt.cm.get_cmap("tab10")
plate_colors = {dev: cmap(i) for i, dev in enumerate(sorted(KEEP))}

print(f"{len(pdf)} paired tests, {len(df)} test-stage points")


# ===================================================================
# Stage 1: Find k from paired differences
# ===================================================================
pdf["temp_bucket"] = (pdf["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
bucket_counts = pdf.groupby("temp_bucket").size().to_dict()
pdf["weight"] = pdf["temp_bucket"].map(lambda b: 1.0 / bucket_counts[b])

y = pdf["delta_error"].values.astype(float)
w = pdf["weight"].values.astype(float)

X = np.column_stack([
    np.ones(len(pdf)),
    pdf["force_ratio"].values.astype(float),
    pdf["k_predictor"].values.astype(float),
])
sw = np.sqrt(w)
beta = np.linalg.lstsq(X * sw[:, None], y * sw, rcond=None)[0]
a_val, b1_val = beta[0], beta[1]
k_val = -beta[2] / 100.0

y_pred = X @ beta
ss_res = np.sum(w * (y - y_pred) ** 2)
ss_tot = np.sum(w * (y - np.average(y, weights=w)) ** 2)
r2_k = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

print(f"\nStage 1: k = {k_val:.6f}, wR2 = {r2_k:.4f}")


# ===================================================================
# Plot 1: k investigation — paired scatter
# ===================================================================
fig, axes = plt.subplots(1, 2, figsize=(16, 6))

# Left: delta_error vs temperature (raw look)
ax = axes[0]
for dev in sorted(KEEP):
    plate = pdf[pdf["device_id"] == dev]
    short = dev.split(".")[-1][-4:]
    ax.scatter(plate["temp_f"], plate["delta_error"],
               c=[plate_colors[dev]], s=60, alpha=0.8,
               edgecolors="black", linewidths=0.5, label=short)
# Overall trend
if len(pdf) >= 2:
    z = np.polyfit(pdf["temp_f"], pdf["delta_error"], 1)
    x_line = np.linspace(pdf["temp_f"].min(), pdf["temp_f"].max(), 50)
    ax.plot(x_line, np.polyval(z, x_line), "r--", lw=2, alpha=0.7,
            label=f"slope={z[0]:.3f}%/F")
ax.axhline(0, color="gray", ls=":", lw=0.8)
ax.axvline(IDEAL_TEMP_F, color="gray", ls=":", lw=0.8, alpha=0.5)
ax.set_xlabel("Temperature (F)")
ax.set_ylabel("BW error - DB error (%)")
ax.set_title("Does the BW-DB gap change with temperature?")
ax.legend(fontsize=8)

# Right: delta_error vs k_predictor (the formal regression)
ax = axes[1]
for dev in sorted(KEEP):
    plate = pdf[pdf["device_id"] == dev]
    short = dev.split(".")[-1][-4:]
    ax.scatter(plate["k_predictor"], plate["delta_error"],
               c=[plate_colors[dev]], s=60, alpha=0.8,
               edgecolors="black", linewidths=0.5, label=short)
# Fit line
x_range = np.linspace(pdf["k_predictor"].min(), pdf["k_predictor"].max(), 50)
mean_fr = pdf["force_ratio"].mean()
y_fit = a_val + b1_val * mean_fr + beta[2] * x_range
ax.plot(x_range, y_fit, "r-", lw=2, alpha=0.8, label=f"k = {k_val:.6f}")
ax.axhline(0, color="gray", ls=":", lw=0.8)
ax.axvline(0, color="gray", ls=":", lw=0.8)
ax.set_xlabel(r"$\Delta T \times (F_{BW} - F_{DB}) / 550$")
ax.set_ylabel("BW error - DB error (%)")
ax.set_title("k regression (force-weighted predictor)")
ax.legend(fontsize=8)

fig.suptitle(
    f"Type 06 (plates 40, 42, 43) — k Investigation\n"
    f"k = {k_val:.6f}, wR2 = {r2_k:.4f} — k is negligible",
    fontsize=13,
)
plt.tight_layout()
fig.savefig(os.path.join(OUT, "subset_k_investigation.png"), dpi=150)
print("Saved subset_k_investigation.png")
plt.close(fig)


# ===================================================================
# Stage 2: Find c per plate with k known
# ===================================================================
delta_t = df["delta_t"].values.astype(float)
force = df["force_n"].values.astype(float)
df["error_adjusted"] = df["avg_signed_pct"] + delta_t * k_val * 100.0 * (force - FREF) / FREF

plate_results = []
for dev in sorted(KEEP):
    plate = df[df["device_id"] == dev].copy()
    plate["temp_bucket"] = (plate["delta_t"] / BUCKET_SIZE).round() * BUCKET_SIZE
    bc = plate.groupby("temp_bucket").size().to_dict()
    plate["weight"] = plate["temp_bucket"].map(lambda b: 1.0 / bc[b])

    dt = plate["delta_t"].values.astype(float)
    ya = plate["error_adjusted"].values.astype(float)
    wa = plate["weight"].values.astype(float)

    Xp = np.column_stack([np.ones_like(dt), dt])
    swp = np.sqrt(wa)
    bp = np.linalg.lstsq((Xp * swp[:, None]), ya * swp, rcond=None)[0]
    c_plate = -bp[1] / 100.0

    yp = Xp @ bp
    ssr = np.sum(wa * (ya - yp) ** 2)
    sst = np.sum(wa * (ya - np.average(ya, weights=wa)) ** 2)
    r2p = 1.0 - ssr / sst if sst > 0 else 0.0

    plate_results.append({
        "device_id": dev, "c": c_plate, "intercept": bp[0], "r2": r2p,
    })
    print(f"  {dev}: c={c_plate:.6f}, intercept={bp[0]:+.2f}%, wR2={r2p:.4f}")

c_vals = [r["c"] for r in plate_results]
avg_c = np.mean(c_vals)
std_c = np.std(c_vals, ddof=1)
intercepts = {r["device_id"]: r["intercept"] for r in plate_results}
print(f"\n  Averaged c = {avg_c:.6f} (std = {std_c:.6f})")


# ===================================================================
# Plot 2: c investigation — per-plate panels
#   Row per plate, 3 cols: no correction / after c / after c+k
# ===================================================================
n_plates = len(plate_results)
fig, axes = plt.subplots(n_plates, 3, figsize=(18, 4.5 * n_plates), squeeze=False)

for i, r in enumerate(plate_results):
    dev = r["device_id"]
    plate = df[df["device_id"] == dev].copy()
    c_p = r["c"]
    dt = plate["delta_t"].values.astype(float)
    f = plate["force_n"].values.astype(float)
    y_orig = plate["avg_signed_pct"].values.astype(float)

    plate["corrected_c"] = y_orig + dt * c_p * 100.0
    plate["corrected_ck"] = y_orig + (dt * c_p + dt * k_val * (f - FREF) / FREF) * 100.0

    for j, (col, title) in enumerate([
        ("avg_signed_pct", "No correction"),
        ("corrected_c", f"After c = {c_p:.5f}"),
        ("corrected_ck", f"After c = {c_p:.5f}, k = {k_val:.6f}"),
    ]):
        ax = axes[i][j]
        for stage_key, style in STAGE_STYLES.items():
            stage_data = plate[plate["stage"] == stage_key]
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
    f"Type 06 (plates 40, 42, 43) — Per-Plate c Results\n"
    f"Shared k = {k_val:.6f} (negligible), c fitted per plate",
    fontsize=13,
)
plt.tight_layout()
fig.savefig(os.path.join(OUT, "subset_per_plate_panels.png"), dpi=150)
print("Saved subset_per_plate_panels.png")
plt.close(fig)


# ===================================================================
# Plot 3: slope overlay — intercepts zeroed, averaged c applied
# ===================================================================
df["zeroed"] = df["avg_signed_pct"] - df["device_id"].map(intercepts)
dt_all = df["delta_t"].values.astype(float)
f_all = df["force_n"].values.astype(float)
y_z = df["zeroed"].values.astype(float)

df["zeroed_after_c"] = y_z + dt_all * avg_c * 100.0
df["zeroed_after_ck"] = y_z + (dt_all * avg_c + dt_all * k_val * (f_all - FREF) / FREF) * 100.0

fig, axes = plt.subplots(1, 3, figsize=(20, 6), sharey=True)
for ax, col, title in [
    (axes[0], "zeroed", "No correction"),
    (axes[1], "zeroed_after_c", f"After avg c = {avg_c:.5f}"),
    (axes[2], "zeroed_after_ck", f"After avg c = {avg_c:.5f}, k = {k_val:.6f}"),
]:
    for dev in sorted(KEEP):
        plate = df[df["device_id"] == dev]
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
    f"Type 06 (plates 40, 42, 43) — Slope Overlay\n"
    f"Intercepts removed. avg c = {avg_c:.6f} (std {std_c:.6f}), k = {k_val:.6f}",
    fontsize=12,
)
plt.tight_layout()
fig.savefig(os.path.join(OUT, "subset_slope_overlay.png"), dpi=150)
print("Saved subset_slope_overlay.png")
plt.close(fig)

print("\nDone.")
