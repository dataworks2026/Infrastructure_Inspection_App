"""
Unit tests for the low-severity forecast guard in
app.services.analytics.forecast._cap_low_severity_forecast.

The LightGBM forecaster was trained on synthetic data where S1/S2 never
appeared as forecast targets, so it bias-predicts S4 for low-severity assets.
The guard caps a higher prediction at the current severity for assets currently
at S1/S2 (and marks confidence Medium), while leaving S3/S4 assets and
non-worsening predictions untouched.
"""

import pytest

from app.services.analytics.forecast import _cap_low_severity_forecast


# ── S1/S2 assets: spurious higher predictions are capped ──────────────────

def test_s1_asset_spurious_s4_capped_to_s1():
    pred, conf = _cap_low_severity_forecast(curr_sev=1, pred=4, conf="High")
    assert pred == 1
    assert conf == "Medium"


def test_s2_asset_spurious_s4_capped_to_s2():
    pred, conf = _cap_low_severity_forecast(curr_sev=2, pred=4, conf="High")
    assert pred == 2
    assert conf == "Medium"


def test_s1_asset_predicted_s2_capped_to_s1():
    # Any prediction above the current severity is capped for S1/S2 assets.
    pred, conf = _cap_low_severity_forecast(curr_sev=1, pred=2, conf="Medium")
    assert pred == 1
    assert conf == "Medium"


# ── S1/S2 assets: non-worsening predictions are untouched ─────────────────

def test_s2_asset_stable_prediction_untouched():
    pred, conf = _cap_low_severity_forecast(curr_sev=2, pred=2, conf="High")
    assert pred == 2
    assert conf == "High"  # confidence NOT downgraded when nothing was capped


def test_s2_asset_improving_prediction_untouched():
    pred, conf = _cap_low_severity_forecast(curr_sev=2, pred=1, conf="Low")
    assert pred == 1
    assert conf == "Low"


# ── S3/S4 assets: never capped (a genuine worsening must survive) ──────────

def test_s3_asset_worsening_to_s4_not_capped():
    pred, conf = _cap_low_severity_forecast(curr_sev=3, pred=4, conf="High")
    assert pred == 4
    assert conf == "High"


def test_s4_asset_prediction_not_capped():
    pred, conf = _cap_low_severity_forecast(curr_sev=4, pred=4, conf="Medium")
    assert pred == 4
    assert conf == "Medium"


@pytest.mark.parametrize("curr,pred_in,expected_pred,capped", [
    (1, 4, 1, True),
    (1, 3, 1, True),
    (2, 3, 2, True),
    (2, 2, 2, False),
    (3, 4, 4, False),
    (4, 4, 4, False),
])
def test_guard_matrix(curr, pred_in, expected_pred, capped):
    pred, conf = _cap_low_severity_forecast(curr, pred_in, "High")
    assert pred == expected_pred
    assert (conf == "Medium") == capped
