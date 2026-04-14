# Temperature Coefficient Investigation Report

## The Problem

Force plates measure less accurately as temperature moves away from room temperature (~76°F). At cold temperatures, readings drift high. At hot temperatures, they drift low. The further from room temp, the worse it gets.

Without correction, a plate that's accurate to ±1% at 76°F might be off by 3-5% at 45°F or 90°F. This is a hardware-level thermal effect on the strain gauge sensors.

## What We Learned About the Plates

### The thermal drift is linear and consistent

For all plate types, the relationship between temperature and error is approximately linear. A plate at 56°F (20° below room temp) drifts about twice as much as one at 66°F (10° below). This means a simple proportional correction works — no need for lookup tables or polynomial curves.

### The drift is similar across plates of the same type

Within a plate type, different individual plates show very similar thermal drift rates. Type 06 plates (excluding one damaged unit) had drift rates of 0.001304-0.001430 — a tight cluster. This means we can use one correction value per plate type rather than calibrating each plate individually.

### XL plates have a force-dependent component

For Lite (06) and Launchpad (07+11) plates, the thermal drift affects all forces equally — a 200N dumbbell measurement and a 1000N bodyweight measurement drift by the same percentage at the same temperature. But for XL plates (08+12), heavier loads drift more than lighter ones. This means XL plates need a second correction term that accounts for force.

### Old-gen vs new-gen plates

Older plates (Type 07, Type 08) have less accurate temperature sensors that read ~3-4°F hot. This doesn't break the correction (the model is trained with the same sensor), but it means the old plates respond slightly differently to correction values optimized for newer plates. In practice, using the newer plates' optimal values on old plates still helps — just not as much.

### Excluded and flagged plates

Two plates were excluded from analysis entirely, and one was flagged as an old-gen outlier. To verify these decisions, we checked each plate's performance at room temperature (71-81°F), where temperature correction has no effect. If a plate performs poorly at room temp, the issue isn't thermal — the plate itself is damaged or miscalibrated.

| Plate | Room Temp MAE | Other Plates (same type) Room Temp MAE | Ratio | Status |
|---|---|---|---|---|
| **06.00000025** | 5.31% | 1.23% | **4.3x worse** | Excluded — damaged |
| **08.00000038** | 12.34% | 1.08% | **11.4x worse** | Excluded — damaged |
| **07.00000051** | 1.85% | 1.46% | 1.3x worse | Included — old-gen sensor |

- **06.00000025**: Over 4x worse than other Lite plates at room temperature. This plate has a fundamental accuracy problem unrelated to temperature. Temperature correction cannot help — the errors are not thermally driven (R² near zero in regression). Excluded from all Type 06 analysis and optimization.

- **08.00000038**: Over 11x worse than other XL plates at room temperature. At 12.34% average error even at ideal conditions, this plate is clearly damaged or severely miscalibrated. Correction makes it worse. Excluded from all Type 08+12 analysis.

- **07.00000051**: Only 1.3x worse than the Type 11 plates at room temperature — within acceptable range. The gap widens at extreme temperatures (all-temp MAE 3.23% vs 2.11%) because the old-gen temperature sensor reads ~3-4°F hot, making the c correction slightly off. This plate is functional but has a less accurate sensor. It is **included** in the final 07+11 analysis and production values. The c=0.0015 value was optimized for the four Type 11 plates (which achieve R²=0.001, p=0.90 — essentially perfect temperature decorrelation). The 07 plate gets the same c and performs adequately (1.85% at room temp, 2.42% overall after correction).

## How We Measure Performance

### What "signed error" means

For each test, we place a known weight on the plate and measure what the plate reports. The signed error is:

```
signed_error = (measured - actual) / actual × 100%
```

+2% means the plate reads 2% too high. -3% means it reads 3% too low.

### What wMAE means

wMAE (weighted mean absolute error) is our primary metric. It's the average of |signed_error| across all tests, weighted so that each temperature range contributes equally.

**Why weighted?** About 60% of our test data is near room temperature (71-81°F), where errors are small and any correction looks fine. The extreme temperatures (40-55°F, 85-95°F) are where correction quality actually matters, but they're outnumbered. Without weighting, a bad correction that fails at extremes but works near room temp would look decent. With weighting, every 5°F temperature bucket counts equally, so extreme temperatures get fair representation.

**Practically:** A wMAE of 2.5% means the plate is off by 2.5% on average across all temperatures, with equal emphasis on cold, warm, and hot conditions. After correction, a wMAE of 1.2% means we've brought the average error down to 1.2%.

### Baseline statistics (no correction)

| Plate Type | Plates | Tests | wMAE | R² (error vs temp) | p-value | Temp Range | Pattern |
|---|---|---|---|---|---|---|---|
| 06 (Lite) | 4 | 54 pts | 2.70% | 0.66 | 1.1e-10 | 43-87°F | Linear drift, uniform across forces |
| 07+11 (Launchpad) | 5 | 86 pts | 2.92% | 0.78 | 1.2e-21 | 44-93°F | Linear drift, uniform across forces |
| 08+12 (XL) | 4 | 77 pts | 2.55% | 0.44 | 8.7e-08 | 41-97°F | Linear drift + force-dependent component |

Before correction, error is strongly correlated with temperature for all plate types (p < 0.0001). R² of 0.44-0.78 means temperature explains 44-78% of the error variance.

All plate types show clear linear thermal drift. The XL plates have the highest baseline error and the most complex drift pattern.

---

## The Correction System

Two-stage correction applied in the processing pipeline:

- **Stage 1 (c):** Applied to raw sensor values before the neural network: `corrected = raw × (1 + deltaT × c)` where `deltaT = T_sensor - 76°F`. This uniformly scales all sensors to compensate for thermal drift. One c value per plate type.

- **Stage 2 (k):** Applied to the neural network's force output: `Fz_final = Fz × (1 + deltaT × k × (|Fz| - 550) / 550)`. This corrects for force-dependent thermal drift. Only needed for XL plates.

---

## What We Tried

### Approach 1: Pooled Regression with Bias Correction

Pooled all plates of a type into one regression. Applied per-cell bias correction first (from room-temp tests) to isolate thermal drift from manufacturing offsets.

**Result for Type 06:** c=0.00186, k≈0

**Problem:** Bias correction assumes individual cells are consistent over time — they aren't. We were correcting against noise. Also, pooling all plates can't handle plates with different temp sensors.

### Approach 2: Per-Plate Regression (no intercept)

Fit c and k independently per plate with no bias correction. Average across plates.

**Result for Type 06:** avg c=0.00155, k noisy

**Problem:** Without an intercept, the model forces predicted error to zero at room temp. But each plate has a manufacturing offset (some read 0.5% high, some 0.3% low). That offset leaked into the slope estimate, pulling c down.

### Approach 3: Per-Plate Regression (with intercept)

Added an intercept to absorb each plate's baseline offset.

**Result for Type 06:** avg c=0.00157, k still noisy (std > mean)

**Problem:** c and k competed in the same regression. With only ~18 data points per plate and only two force levels (bodyweight and dumbbell), the model couldn't reliably separate temperature drift (c) from force-dependent temperature drift (k).

### Approach 4: Paired BW/DB Difference Analysis

Key insight: every test session measures bodyweight AND dumbbell at the exact same temperature, on the same plate, at the same moment. Subtracting their errors cancels temperature drift (c) and manufacturing offsets completely, isolating the force-dependent signal (k).

**Result for Type 06:** k≈0 (confirmed: no force-dependent drift). Per-plate c=0.0014 with tight consistency (std=0.000061).

**Why it works:** c and k never compete in the same regression. k is estimated from the cleanest possible signal. c gets the full dataset with k already known.

### Approach 5: Pipeline Verification & Sweep

The paired analysis gives a starting c from math on raw data. But the actual pipeline applies c to sensors before the neural network, which is nonlinear. The math-optimal c and the pipeline-optimal c aren't necessarily the same.

So we processed test files through the real pipeline at multiple c values, then swept k for each to find the best combination. This gives ground truth — actual pipeline performance, not a projection.

**Key finding:** The neural network amplifies c differently at different force levels. For Lite and Launchpad plates, this effect is tiny (~0.02% difference) — not worth correcting. For XL plates, it's significant and is where k comes from.

---

## Results

### Type 06 (Lite) — 4 clean plates

| | Value |
|---|---|
| **c** | **0.0014** |
| **k** | **0** |
| Baseline wMAE | 2.70% |
| After correction wMAE | 1.41% |
| **Reduction** | **48%** |
| R² before | 0.66 (p = 1.1e-10) |
| R² after | 0.03 (p = 0.63) |
| Previous production c | 0.002 (too high) |

The simplest case. Temperature drift is uniform across all forces. c=0.0014 brings the weighted average error down from 2.70% to 1.41%. After correction, the remaining error shows no significant correlation with temperature (p=0.63) — the temperature-dependent component has been removed. Higher c values (0.0015-0.0017) gave marginally better wMAE but only with a negative k that overcorrects heavy weights and hurts light weights. Chose c=0.0014 with no k for simplicity — treats all weights uniformly.

### Type 07+11 (Launchpad) — 5 plates (1x old-gen 07, 4x 11)

| | Value |
|---|---|
| **c** | **0.0015** |
| **k** | **0** |
| Baseline wMAE | 2.92% |
| After correction wMAE | 1.38% |
| **Reduction** | **53%** |
| R² before | 0.78 (p = 1.2e-21) |
| R² after | 0.14 (p = 0.10) |
| Previous production c | 0.0025 (too high) |

Similar behavior to Type 06. c=0.0015 is the clear minimum for the 11s. The combined 07+11 stats (R²=0.14, p=0.10) are dragged down by the old-gen 07 plate. **Type 11 plates alone show R²=0.001, p=0.90** — essentially zero remaining temperature correlation. The 07 plate's inaccurate temp sensor means c=0.0015 isn't quite right for it, but it's one plate and the 11s are the fleet going forward.

### Type 08+12 (XL) — 4 clean plates (1x old-gen 08, 1x 08, 2x 12)

| | Value |
|---|---|
| **c** | **0.0010** |
| **k** | **0.0010** |
| **FREF** | **550** |
| Baseline wMAE | 2.55% |
| After c only wMAE | 2.03% |
| After c+k wMAE | 1.75% |
| **Reduction** | **31%** |
| R² before | 0.44 (p = 8.7e-08) |
| R² after c+k | 0.02 (p = 0.52) |
| Previous production c | 0.0009 (close, but k was missing) |

Different from the smaller plates. c alone provides only 20% reduction (2.55% → 2.03%). k is essential — the paired analysis confirmed a real force-dependent thermal effect (R2 improvement from k = +0.31, vs 0.005 for Type 06). Adding k brings total reduction to 31%. After c+k, remaining error is not significantly correlated with temperature (p=0.52).

The k correction was stable across all c values tested (k_regression ≈ 0.00105 regardless of c). Deadzone and alternative pivot approaches were explored but didn't justify added complexity.

XL plates are inherently harder to correct. Old-gen 08 plates respond differently than 12s (suspected temp sensor differences). 08.00000048 barely responds to k at all. More data from additional 12-series plates would help refine these values.

---

## Summary

| Plate Type | c | k | Baseline wMAE | Final wMAE | Reduction | R² before | R² after | p after | Old c |
|---|---|---|---|---|---|---|---|---|---|
| **06 (Lite)** | 0.0014 | 0 | 2.70% | 1.41% | 48% | 0.66 | 0.03 | 0.63 | 0.002 |
| **07+11 (Launchpad)** | 0.0015 | 0 | 2.92% | 1.38% | 53% | 0.78 | 0.14 | 0.10* | 0.0025 |
| **08+12 (XL)** | 0.0010 | 0.0010 | 2.55% | 1.75% | 31% | 0.44 | 0.02 | 0.52 | 0.0009 |

\* The 07+11 p-value is dragged down by the old-gen 07 plate. Type 11 plates alone: R²=0.001, p=0.90, wMAE=1.12%.


Unweighted MAE (what the average test experiences — most tests are near room temp):

| Plate Type | Baseline MAE | Final MAE | Reduction |
|---|---|---|---|
| **06 (Lite)** | 1.94% | 1.31% | 32% |
| **07+11 (Launchpad)** | 2.32% | 1.28% | 45% |
| **08+12 (XL)** | 2.02% | 1.66% | 18% |

For all plate types, after correction:
- **p > 0.05** — remaining error is not significantly correlated with temperature
- **R² drops to near zero** — temperature no longer explains the error variance
- The remaining 1.1-1.8% error comes from non-thermal sources (NN imprecision, weight placement variation, sensor noise)

Key findings:
- Previous production c values were all too high (overcorrecting)
- k is only needed for XL plates — Lite and Launchpad plates don't benefit from it
- Old-gen plates with less accurate temp sensors perform worse but not badly enough to warrant separate c values
- The correction reduces temperature-dependent error by 31-53% depending on plate type

### What the statistics prove

**Before correction**, error is strongly correlated with temperature. R² values of 0.44-0.78 mean temperature explains 44-78% of the measurement error. The slopes of -0.12 to -0.22 %/°F mean that for every degree below room temp, the plate reads roughly 0.12-0.22% too high. The p-values (all < 1e-7) confirm this isn't random — there's a real, systematic thermal effect.

**After correction**, the temperature correlation disappears. R² drops to 0.02-0.14 and p-values rise above 0.05 (not statistically significant). The correction has removed the temperature-dependent component of the error. What remains — the 1.1-1.8% wMAE — is from sources unrelated to temperature: neural network imprecision, weight placement variation on the plate, and sensor noise. These cannot be fixed by temperature correction.

The final values (see `output_final/final_stats.csv`) were generated by `final_report.py` using actual pipeline-processed test files, not projections.

---

## Analysis Scripts

All scripts live in `tools/FluxLite/analysis/ck_paired/`:

| Script | Purpose |
|---|---|
| `run.py 06` | Paired analysis: find starting c and k from raw data |
| `verify_ck.py 11 --c 0.0013 0.0015 ...` | Pipeline sweep: rank (c,k) combos on real pipeline output |
| `plot_c.py --plates 11 -- 0.0015` | Visualize specific c value with force bands |
| `plot_c.py --plates 08 12 --k 0.001 -- 0.001` | Visualize with fixed k value |
| `verify.py` | Compare regression projections vs pipeline (diagnostic) |

All assessments use temperature-bucket weighted MAE throughout.

---

## Final Correction Plots

Generated by `final_report.py`. Each plot shows signed error vs temperature with force bands (DB, BW 500-700N, BW 700-900N, BW 900-1100N). Panel titles include wMAE, R², and p-value.

### Type 06 (Lite) — c = 0.0014, k = 0

![Type 06 Final](output_final/final_06.png)

### Type 07+11 (Launchpad) — c = 0.0015, k = 0

![Type 07+11 Final](output_final/final_07+11.png)

### Type 08+12 (XL) — c = 0.0010, k = 0.0010

![Type 08+12 Final](output_final/final_08+12.png)
