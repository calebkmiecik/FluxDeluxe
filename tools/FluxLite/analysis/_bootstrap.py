"""
Shared bootstrap for analysis investigation scripts.

Usage in any run.py:
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from _bootstrap import *
"""
import sys
import os

# Ensure FluxLite/src is importable
_FLUXLITE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_SRC = os.path.join(_FLUXLITE_ROOT, "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)
if _FLUXLITE_ROOT not in sys.path:
    sys.path.insert(0, _FLUXLITE_ROOT)

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")  # non-interactive backend — save to files, no GUI popups
import matplotlib.pyplot as plt

from src.app_services.repositories.test_file_repository import TestFileRepository
from src.app_services.analysis.temperature_analyzer import TemperatureAnalyzer
from src.app_services.temperature_processing_service import TemperatureProcessingService
from src.app_services.temperature_baseline_bias_service import TemperatureBaselineBiasService
from src.app_services.temperature_coef_rollup.scoring import score_run_against_bias
from src.app_services.temperature_coef_rollup.eligibility import (
    baseline_csvs_for_devices,
    eligible_runs_by_device_and_temp,
)
from src.app_services.temperature_coef_rollup.unified_k import (
    compute_c_and_k_from_stage_split_rows,
    evaluate_unified_k_bias_metrics,
)
from src.app_services.temperature_coef_rollup.stage_split_per_test import (
    export_stage_split_per_test_report,
)
from src.app_services.temperature_post_correction import apply_post_correction_to_run_data
from src.project_paths import data_dir
from src import config

plt.rcParams.update({"figure.figsize": (12, 6), "figure.dpi": 120})

# Service assembly (mirrors testing.py:37-47 without Qt)
repo = TestFileRepository()
analyzer = TemperatureAnalyzer()
processing = TemperatureProcessingService(repo=repo, hardware=None)
bias_svc = TemperatureBaselineBiasService(
    repo=repo, analyzer=analyzer, processing=processing
)


def ensure_output_dir(script_file: str) -> str:
    """Create and return the output/ directory next to the calling script."""
    out = os.path.join(os.path.dirname(os.path.abspath(script_file)), "output")
    os.makedirs(out, exist_ok=True)
    return out
