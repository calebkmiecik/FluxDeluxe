"""Check room-temp performance of excluded/flagged plates using raw pipeline data."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

IDEAL_TEMP_F = float(getattr(config, "TEMP_IDEAL_ROOM_TEMP_F", 76.0))

CHECKS = [
    {"dev": "06.00000025", "compare_type": "06"},
    {"dev": "08.00000038", "compare_type": "08"},
    {"dev": "07.00000051", "compare_type": "11"},
]


def analyze_device(device_id):
    """Collect baseline errors for a single device."""
    tests = repo.list_temperature_tests(device_id)
    rows = []
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
        result = analyzer.analyze_single_processed_csv(baseline_path, meta)
        stages = (result.get("data") or {}).get("stages") or {}
        for stage_key in ("bw", "db"):
            stage = stages.get(stage_key, {})
            target_n = float(stage.get("target_n") or 0)
            if target_n <= 0:
                continue
            cells = stage.get("cells") or []
            if not cells:
                continue
            errors = [(float(c.get("mean_n", 0)) - target_n) / target_n * 100 for c in cells]
            rows.append({"temp_f": temp_f, "error": sum(errors) / len(errors)})
    return pd.DataFrame(rows)


for check in CHECKS:
    dev = check["dev"]
    compare_type = check["compare_type"]

    print(f"{dev}:")
    df = analyze_device(dev)
    if df.empty:
        print(f"  No processed data found\n")
        continue

    room = df[(df["temp_f"] >= 71) & (df["temp_f"] <= 81)]
    print(f"  All tests: n={len(df)}, MAE={df['error'].abs().mean():.2f}%")
    if not room.empty:
        print(f"  Room temp (71-81F): n={len(room)}, MAE={room['error'].abs().mean():.2f}%")
    else:
        print(f"  Room temp: no tests in 71-81F range")

    # Compare to other plates of same comparison type
    all_devs = repo.list_temperature_devices() or []
    compare_devs = [d for d in all_devs if d.startswith(compare_type + ".") and d != dev]
    if compare_devs:
        other_rows = []
        for cd in compare_devs:
            cdf = analyze_device(cd)
            if not cdf.empty:
                other_rows.append(cdf)
        if other_rows:
            others = pd.concat(other_rows, ignore_index=True)
            other_room = others[(others["temp_f"] >= 71) & (others["temp_f"] <= 81)]
            print(f"  Other type {compare_type} plates ({len(compare_devs)} plates):")
            print(f"    All tests: MAE={others['error'].abs().mean():.2f}%")
            if not other_room.empty:
                print(f"    Room temp: MAE={other_room['error'].abs().mean():.2f}%")
    print()
