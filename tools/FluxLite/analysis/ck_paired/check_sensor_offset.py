"""Check temperature sensor readings for old-gen vs new-gen plates at room temp."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _bootstrap import *

OLD_GEN = {"06.0000000c", "07.00000051", "08.00000031", "08.00000038"}
# Everything else is new gen

all_devices = repo.list_temperature_devices() or []

print("Room-temp test sensor readings (tests at true room temp ~70-80F):\n")

for dev_type in ["06", "07", "11", "08", "12"]:
    devices = [d for d in all_devices if d.startswith(dev_type + ".")]
    if not devices:
        continue
    print(f"=== Type {dev_type} ===")
    for dev in sorted(devices):
        gen = "OLD" if dev in OLD_GEN else "NEW"
        tests = repo.list_temperature_tests(dev)
        room_temps = []
        for raw_csv in tests:
            meta = repo.load_temperature_meta_for_csv(raw_csv)
            if not meta:
                continue
            temp_f = repo.extract_temperature_f(meta)
            if temp_f is None:
                continue
            # Only include tests that are likely room temp
            # (sensor reads between 65-85F — loose range to capture both gens)
            if 65 <= temp_f <= 85:
                room_temps.append(temp_f)
        if room_temps:
            avg = sum(room_temps) / len(room_temps)
            lo = min(room_temps)
            hi = max(room_temps)
            print(f"  {dev} [{gen}]: {len(room_temps)} room-ish tests, "
                  f"avg={avg:.1f}F, range={lo:.1f}-{hi:.1f}F")
        else:
            print(f"  {dev} [{gen}]: no room temp tests")
    print()
