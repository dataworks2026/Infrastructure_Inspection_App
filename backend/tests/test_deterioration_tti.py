"""
Unit tests for the predictive analytics trend + TTI logic.

Covers two QA-reported fixes:
  - Accelerating trend must be labeled 'accelerating' (not 'worsening') when the
    deterioration rate is itself increasing, even if the overall slope is modest.
  - An improving asset's TTI note must suggest verifying the maintenance record.
"""

import pandas as pd

from app.services.analytics.deterioration import _classify_trend
from app.services.analytics.tti import calculate_tti


# ── Trend classification ──────────────────────────────────────────────

def test_acceleration_flag_drives_accelerating_label():
    # Modest overall slope but rate increasing across the series.
    scores = [1, 1, 2, 4]
    assert _classify_trend(0.5, 0.0, scores, acceleration=True) == "accelerating"


def test_worsening_without_acceleration():
    scores = [1, 2, 3]
    assert _classify_trend(0.5, 0.0, scores, acceleration=False) == "worsening"


def test_steep_slope_still_accelerating_without_flag():
    scores = [1, 2, 4]
    assert _classify_trend(0.9, 0.0, scores, acceleration=False) == "accelerating"


def test_improving_label():
    scores = [4, 3, 2, 1]
    assert _classify_trend(-0.5, 0.0, scores, acceleration=False) == "improving"


def test_stable_label():
    scores = [2, 2, 2]
    assert _classify_trend(0.0, 0.0, scores, acceleration=False) == "stable"


# ── TTI improving note ────────────────────────────────────────────────

def _det_row(**kw):
    base = dict(
        asset_id="A1", asset_name="Pier 1", asset_type="coastal",
        latest_severity=2, severity_change_rate=0.0, inspection_count=3,
    )
    base.update(kw)
    return base


def test_improving_tti_note_mentions_maintenance_record():
    df = pd.DataFrame([_det_row(latest_severity=2, severity_change_rate=-0.5)])
    out = calculate_tti(df, {})
    note = out.iloc[0]["tti_note"].lower()
    assert "improving" in note
    assert "maintenance record" in note
    assert out.iloc[0]["tti_label"] == "Not applicable"


def test_stable_tti_note_has_no_maintenance_prompt():
    df = pd.DataFrame([_det_row(latest_severity=2, severity_change_rate=0.0)])
    out = calculate_tti(df, {})
    note = out.iloc[0]["tti_note"].lower()
    assert "stable" in note
    assert "maintenance record" not in note


def test_critical_but_improving_note_mentions_maintenance_record():
    df = pd.DataFrame([_det_row(latest_severity=4, severity_change_rate=-0.4)])
    out = calculate_tti(df, {})
    note = out.iloc[0]["tti_note"].lower()
    assert "maintenance record" in note
    assert out.iloc[0]["tti_label"] == "Not applicable"
