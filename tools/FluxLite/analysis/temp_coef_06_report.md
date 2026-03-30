# Type 06 Temperature Coefficient Investigation

## Background

Our force plates drift with temperature. We correct this in two stages:

**Stage 1 (c):** Applied per-sensor before the neural network model.
```
corrected = raw * (1 + (T - 76) * c)
```
- `c` is a single scalar per plate type
- Scales every sensor reading proportionally to temperature deviation from 76F

**Stage 2 (k):** Applied to the net Fz output after the model.
```
Fz_final = Fz * (1 + (T - 76) * k * ((|Fz| - 550) / 550))
```
- `k` captures force-dependent thermal error that `c` doesn't handle
- Zero effect when Fz = 550N (the reference force)
- Scales up for heavier loads, down for lighter loads

Previously, c and k were found by brute-force: try many c values per test, score each, and average the best ones. This investigation derives them analytically.

## Data

- 4 type-06 devices (excluding 06.00000025, a damaged plate)
- 27 non-baseline temperature tests spanning 43F to 86F
- Each test has a bodyweight stage (600-1030N) and dumbbell stage (206N)
- Per-cell bias correction applied to isolate thermal drift from manufacturing offsets

## Investigation 1: Does c work as expected?

**Question:** Does changing c by 0.001 actually shift output by 0.1% per degree F through the full pipeline?

**Method:** For each test, compared processed-off (no correction) cell values to processed-on (known c) cell values. Computed `actual_scale = on/off` vs `predicted_scale = 1 - (76 - T) * c`.

**Result:** Yes. Residuals < 0.5% for clean plates. The correction model is faithful through the pipeline despite c being applied before the NN and measured after it. The NN is approximately linear with respect to this scaling.

## Investigation 2: Analytical derivation of c and k

**Model:** The uncorrected error for a test at temperature T and force F is:
```
error(T, F) = -(T - 76) * (c + k * (F - 550) / 550) * 100%
```

This is a linear model with two features per data point:
- X1 = deltaT = T - 76
- X2 = deltaT * (F - 550) / 550

Four approaches were tried, progressively refined:

### Approach 1: Brute-force (existing)
Find best c per test per stage (BW/DB separately), then fit c and k from (force, best_c) pairs.

### Approach 2: Two-stage regression (unbucketed)
1. Fit c from test-averaged error vs deltaT
2. Apply c, fit k from cell-level residuals

Problem: 20 of 27 tests are near room temp, dominating the fit and pulling c too low.

### Approach 3: Two-stage regression (bucketed)
Same as above but average tests into 5F temperature buckets before fitting.

Problem: Bucketing at the regression level loses per-test force information.

### Approach 4: Weighted simultaneous regression
Single regression with both features. Each data point keeps its exact force value. Temperature weighting (1/n per 5F bucket) prevents dense temp ranges from dominating.

```
error_pct = beta1 * deltaT + beta2 * deltaT * (F - 550) / 550
c = -beta1 / 100
k = -beta2 / 100
```

## Results

All methods evaluated on the same 54 test-stage data points, graded with temp-weighted metrics (each 5F bucket weighted equally):

| Method | c | k | wMAE after c | wMAE after c+k | wR2 (c) | wR2 (c+k) |
|---|---|---|---|---|---|---|
| Uncorrected | - | - | 2.66% | - | - | - |
| Brute-force | 0.0016 | 0.000467 | 1.58% | 1.56% | 0.6492 | 0.6409 |
| 2-stage unbucketed | 0.0015 | 0.000536 | 1.63% | 1.58% | 0.6333 | 0.6197 |
| 2-stage bucketed | 0.0018 | 0.000154 | 1.53% | 1.53% | 0.6641 | 0.6666 |
| **Weighted simultaneous** | **0.0019** | **0.000156** | **1.51%** | **1.51%** | **0.6664** | **0.6689** |

## Key findings

1. **c = 0.0019 for type 06.** The weighted simultaneous approach produces the best fit. Previous approaches underestimated c because most tests were near room temp, where any c works.

2. **k is not needed for type 06.** Adding k provides < 0.01% improvement. The R2 actually drops in the brute-force and unbucketed approaches when k is added, indicating k is fitting noise. The apparent BW/DB coefficient gap in brute-force (0.0018 vs 0.0014) was caused by DB tests near room temp bottoming out at c=0, not a real force-dependent effect.

3. **Temperature weighting matters.** Without it, the 20 near-room-temp tests (small error, any c works) dominate and pull c down. Weighting each 5F bucket equally lets the extreme temps (where correction matters most) properly influence the fit.

4. **Device 06.00000025 is damaged.** Its data shows anomalous behavior inconsistent with the other 4 devices and should be excluded from calibration.

## Remaining error

The best model (c = 0.0019, k = 0) achieves wR2 = 0.67, meaning temperature explains about 67% of the weighted variance in plate error. The remaining 33% is not temperature-related and cannot be improved by any c or k tuning.

After correction, the weighted mean absolute error drops from 2.66% to 1.51% — a 43% reduction, but far from zero. The residual 1.51% comes from sources unrelated to temperature:
- NN model imprecision (the neural network doesn't perfectly reconstruct force from sensor data)
- Weight placement variation (stepping slightly off-center between tests)
- Per-cell manufacturing differences (partially but not fully captured by bias correction)
- Sensor noise and environmental factors beyond temperature

Temperature correction is one piece of the accuracy puzzle, not a silver bullet. Even a perfect c and k would leave ~1.5% error for type 06 plates.

## Next steps

- Run the weighted simultaneous approach on plate types where k is expected to matter (07, 08, 11, 12)
- Validate by processing actual test files with the derived c and comparing to brute-force results
- Consider updating the production c value for type 06 from 0.002 to 0.0019
