# Temperature Correction Implementation Guide

This guide describes how to implement the temperature correction system derived from the investigation in `temp_coef_report.md`. Follow this exactly for consistency across all projects that consume force plate data.

## Summary of Required Changes

1. Two-stage temperature correction with per-plate-type coefficients
2. Fixed room temperature reference of 76°F for all plates
3. Temperature correction enabled by default

---

## 1. Mathematical Model

### Stage 1: Sensor-level correction (c)

Applied to raw sensor values **before** the neural network. Scales all 8 raw sensor readings uniformly based on temperature deviation from room temperature.

```
corrected_sensor = raw_sensor × (1 + (T_sensor - T_room) × c)
```

Where:
- `raw_sensor`: the uncorrected sensor reading (each of the 8 per-cell sensors)
- `T_sensor`: the temperature reported by the plate's built-in temperature sensor (°F)
- `T_room`: room temperature reference — **depends on device generation** (see §3)
- `c`: per-plate-type coefficient (see §4)

**Applied to all three axes uniformly**: `slopes = {x: c, y: c, z: c}`

### Stage 2: Post-network force correction (k)

Applied to the neural network's Fz output to compensate for force-dependent thermal drift. **Only needed for XL plates (types 08 and 12).**

```
Fz_final = Fz × (1 + (T_sensor - T_room) × k × (|Fz| - F_ref) / F_ref)
```

Where:
- `Fz`: the NN's force output (in Newtons)
- `T_sensor`, `T_room`: same as Stage 1
- `k`: per-plate-type coefficient (see §4)
- `F_ref`: reference force = **550 N** (same for all plate types)

**Behavior:**
- When `|Fz| = F_ref`, the correction has no effect (neutral point at 550 N)
- Above F_ref: correction scales up proportionally (heavier loads get more correction)
- Below F_ref: correction scales in opposite direction
- `k = 0` means no correction (used for types 06, 07, 11 where k wasn't needed)

---

## 2. Implementation Order

To ensure consistency, implement in this order:

1. Define configuration constants (c, k, F_ref, per-generation T_room)
2. Implement generation detection from device ID
3. Implement Stage 1 correction in the raw-data processing step
4. Implement Stage 2 correction in the Fz post-processing step
5. Enable temperature correction by default
6. Validate against the test files used in this investigation

---

## 3. Room Temperature Reference

Use a fixed reference of **76°F** for all plates regardless of generation:

```python
TEMP_IDEAL_ROOM_TEMP_F = 76.0
```

Old-gen plates have temperature sensors that read a few degrees hotter than new-gen plates at the same true room temperature, but we accept this as part of the correction's behavior. The c values in §4 were optimized against pipeline results using this reference for all plates. Changing T_room per generation would require re-running the pipeline sweep with shifted deltaTs, which we chose not to do.

**Note:** The old-gen plates will perform slightly worse than new-gen plates under this system (since their sensor bias makes their effective deltaT smaller than reality). This is accepted — see §7 for the expected wMAE values which already include this effect.

---

## 4. Temperature Coefficients by Plate Type

Set these values in the config. These replace the existing `_TEMP_COEFS` dictionary in `temperature_processing_service.py` (or equivalent location).

```python
# Stage 1 coefficients (c) — applied to raw sensors before NN
TEMP_COEFS_C = {
    "06": 0.0014,  # Lite
    "07": 0.0015,  # Launchpad (same as 11)
    "08": 0.0010,  # XL (same as 12)
    "10": 0.0014,  # (same family as 06, verify if needed)
    "11": 0.0015,  # Launchpad
    "12": 0.0010,  # XL
}

# Stage 2 coefficients (k) — applied post-NN to Fz
TEMP_COEFS_K = {
    "06": 0.0,     # Not needed
    "07": 0.0,     # Not needed
    "08": 0.0010,  # Required — force-dependent drift
    "10": 0.0,     # (verify)
    "11": 0.0,     # Not needed
    "12": 0.0010,  # Required
}

# Reference force for Stage 2 correction (same for all types)
TEMP_POST_CORRECTION_FREF_N = 550.0
```

**Previous (deprecated) values for reference:**

| Type | Old c | New c | Notes |
|---|---|---|---|
| 06 | 0.002 | 0.0014 | Old value was overcorrecting |
| 07 | 0.0025 | 0.0015 | Old value was overcorrecting |
| 08 | 0.0009 | 0.0010 | Close, but k was missing |
| 11 | 0.0025 | 0.0015 | Old value was overcorrecting |
| 12 | 0.0009 | 0.0010 | Close, but k was missing |

---

## 5. Enable by Default

Temperature correction should be **on by default** for all new sessions and processing runs. Locations to check:

- Config flag (e.g., `USE_TEMPERATURE_CORRECTION`): set default to `True`
- Backend processor: `use_temperature_correction=True` as default
- UI controls: checkbox/toggle should default to checked
- Any existing "opt-in" logic should become "opt-out"

Do NOT retroactively process old sessions without confirming the slopes match the new values. If an old session was processed with outdated c values, it needs reprocessing.

---

## 6. Pipeline Integration Checklist

### In the raw CSV processor (Stage 1)

Where c is applied to raw sensor columns:

- [ ] Read `device_id` from meta
- [ ] Look up `c` via `TEMP_COEFS_C[plate_type]`
- [ ] For each row, compute `deltaT = T_sensor - 76.0`
- [ ] Apply `raw × (1 + deltaT × c)` to each sensor's x/y/z columns
- [ ] Adjust sum columns so tare offsets are preserved (same delta logic as `revert_baked_temp_correction`)

### In the NN output processor (Stage 2)

Where Fz gets the post-correction:

- [ ] Look up `k` via `TEMP_COEFS_K[plate_type]`
- [ ] If `k == 0`: skip Stage 2 entirely
- [ ] Otherwise: compute `scale = 1 + deltaT × k × (|Fz| - 550) / 550`
- [ ] Apply `Fz_final = Fz × scale`
- [ ] Recompute derived values (signed error, abs ratio, etc.)

---

## 7. Validation

After implementation, run the validation script to confirm the correction matches the investigation results:

```bash
cd tools/FluxLite/analysis/ck_paired
python final_report.py
```

Expected outcomes (from the investigation):

| Plate Type | c | k | Expected wMAE | Expected R² after | Expected p after |
|---|---|---|---|---|---|
| 06 | 0.0014 | 0 | ~1.41% | ~0.03 | > 0.05 |
| 07+11 | 0.0015 | 0 | ~1.38% | ~0.14 | > 0.05 |
| 08+12 | 0.0010 | 0.0010 | ~1.75% | ~0.02 | > 0.05 |

If any of these diverge significantly, the implementation has a bug. Key things to check:
- Is `deltaT` being computed with the right `T_room` for each device?
- Is c being applied to each of the 8 sensors' x/y/z (not just z)?
- Is the sum column adjustment correct (see `revert_baked_temp_correction` for reference)?
- Is k being applied AFTER the NN, not before?
- Is the correction being applied once, not twice (e.g., doubled up in processing)?

---

## 8. Model Retraining Consideration

Neural network models are trained with temperature correction already applied during calibration. If the c value changes, **models may need retraining** because the NN expects inputs corrected with the old c value.

**Action required:** Coordinate with the calibration team. Any plates whose models were trained with the old c values (0.002, 0.0025, 0.0009) may need:
- Retraining with the new c values, OR
- Continued use of old c values for legacy plates, with new c only for new calibrations

This is out of scope for this guide but must not be overlooked.

---

## 9. Reference

Full investigation report: [`temp_coef_report.md`](temp_coef_report.md)

Analysis scripts: `tools/FluxLite/analysis/ck_paired/`

Final statistics: `tools/FluxLite/analysis/ck_paired/output_final/final_stats.csv`
