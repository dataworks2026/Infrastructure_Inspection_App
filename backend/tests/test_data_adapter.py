"""
Unit tests for app.services.analytics.data_adapter.

Exercises every contract documented in the ClickUp Subtask 9.2 spec:
- Happy path: 3 assets, multiple inspections, correct DataFrame shape
- Multi-tenant isolation: cross-org rows must not appear
- Empty org: returns empty DataFrame with the EXPECTED_COLUMNS schema
- NULL severity detections are filtered out
- Same inspection with multiple detections aggregates to MAX severity
- inspection_date/inspected_at coalesce works in Python (no SQLite
  type-mismatch error)
- Missing organization_id raises ValueError (fail-fast)
"""

from datetime import date, datetime

import pandas as pd
import pytest

from app.services.analytics.data_adapter import (
    EXPECTED_COLUMNS,
    build_analytics_dataframe,
)
from app.models.detection  import Detection
from app.models.image      import Image
from app.models.inspection import Inspection

from tests.conftest import seed_asset, seed_inspection


# ─── happy path ───────────────────────────────────────────────────

def test_returns_dataframe_with_expected_columns(db_session, test_org):
    seed_asset(
        db_session, asset_id="A1",
        organization_id=test_org.organization_id,
        name="Pier 1", infrastructure_type="pier",
    )
    seed_inspection(
        db_session, asset_id="A1",
        organization_id=test_org.organization_id,
        inspection_date=date(2024, 1, 1), severity="S2",
    )

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )

    assert isinstance(df, pd.DataFrame)
    assert list(df.columns) == EXPECTED_COLUMNS
    assert len(df) == 1
    row = df.iloc[0]
    assert row["asset_id"]        == "A1"
    assert row["asset_name"]      == "Pier 1"
    assert row["asset_type"]      == "pier"
    assert row["severity_score"]  == "S2"
    assert row["inspection_date"] == date(2024, 1, 1)


def test_multiple_assets_and_inspections(db_session, test_org):
    for i, asset_id in enumerate(["A1", "A2", "A3"], start=1):
        seed_asset(
            db_session, asset_id=asset_id,
            organization_id=test_org.organization_id,
            name=f"Asset {i}", infrastructure_type="coastal",
        )
        # 3 inspections each
        seed_inspection(db_session, asset_id=asset_id,
            organization_id=test_org.organization_id,
            inspection_date=date(2024, 1, 1), severity="S1")
        seed_inspection(db_session, asset_id=asset_id,
            organization_id=test_org.organization_id,
            inspection_date=date(2024, 6, 1), severity="S2")
        seed_inspection(db_session, asset_id=asset_id,
            organization_id=test_org.organization_id,
            inspection_date=date(2025, 1, 1), severity="S3")

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )

    assert len(df) == 9
    assert set(df["asset_id"].unique()) == {"A1", "A2", "A3"}


# ─── multi-tenant isolation ───────────────────────────────────────

def test_cross_org_rows_excluded(db_session, test_org, other_org):
    # Seed a row for the test org and one for a different org.
    seed_asset(db_session, asset_id="MINE",
        organization_id=test_org.organization_id,
        name="Mine", infrastructure_type="bridge")
    seed_inspection(db_session, asset_id="MINE",
        organization_id=test_org.organization_id,
        inspection_date=date(2024, 5, 1), severity="S1")

    seed_asset(db_session, asset_id="THEIRS",
        organization_id=other_org.organization_id,
        name="Theirs", infrastructure_type="bridge")
    seed_inspection(db_session, asset_id="THEIRS",
        organization_id=other_org.organization_id,
        inspection_date=date(2024, 5, 1), severity="S4")

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )

    asset_ids = set(df["asset_id"])
    assert "MINE"   in asset_ids
    assert "THEIRS" not in asset_ids, \
        "data_adapter must not leak rows from another organization"


def test_asset_id_filter_scopes_to_one_asset(db_session, test_org):
    seed_asset(db_session, asset_id="WANTED",
        organization_id=test_org.organization_id,
        name="Wanted", infrastructure_type="bridge")
    seed_inspection(db_session, asset_id="WANTED",
        organization_id=test_org.organization_id,
        inspection_date=date(2024, 1, 1), severity="S2")

    seed_asset(db_session, asset_id="OTHER",
        organization_id=test_org.organization_id,
        name="Other", infrastructure_type="bridge")
    seed_inspection(db_session, asset_id="OTHER",
        organization_id=test_org.organization_id,
        inspection_date=date(2024, 1, 1), severity="S2")

    df = build_analytics_dataframe(
        db_session,
        organization_id=test_org.organization_id,
        asset_id="WANTED",
    )
    assert set(df["asset_id"]) == {"WANTED"}


# ─── empty / null edge cases ──────────────────────────────────────

def test_empty_org_returns_empty_dataframe(db_session, test_org):
    """No assets at all → empty DataFrame with the right columns."""
    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )
    assert len(df) == 0
    assert list(df.columns) == EXPECTED_COLUMNS


def test_assets_with_no_inspections_excluded(db_session, test_org):
    seed_asset(db_session, asset_id="DEAD",
        organization_id=test_org.organization_id,
        name="No Inspections", infrastructure_type="coastal")

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )
    assert len(df) == 0


def test_null_severity_detections_filtered_out(db_session, test_org):
    seed_asset(db_session, asset_id="NULL",
        organization_id=test_org.organization_id,
        name="Null Severity", infrastructure_type="coastal")
    seed_inspection(db_session, asset_id="NULL",
        organization_id=test_org.organization_id,
        inspection_date=date(2024, 1, 1), severity=None)

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )
    # The detection had severity=NULL so it must be excluded.
    assert "NULL" not in set(df["asset_id"])


def test_inspection_with_only_inspected_at_works(db_session, test_org):
    """User-created inspections set inspected_at (DATETIME) but leave
    inspection_date NULL. Adapter must coalesce them in Python and not
    blow up with SQLite Date/DateTime parse errors."""
    seed_asset(db_session, asset_id="DT",
        organization_id=test_org.organization_id,
        name="Datetime Only", infrastructure_type="bridge")
    seed_inspection(db_session, asset_id="DT",
        organization_id=test_org.organization_id,
        inspection_date=None,
        inspected_at=datetime(2025, 6, 11, 14, 30, 0),
        severity="S3")

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )
    assert len(df) == 1
    assert df.iloc[0]["inspection_date"] == date(2025, 6, 11)


# ─── max severity aggregation per inspection ──────────────────────

def test_multiple_detections_aggregate_to_max_severity(db_session, test_org):
    """One inspection -> many images -> many detections at varying
    severities. The adapter should keep only the worst one per
    (asset_id, inspection_date)."""
    seed_asset(db_session, asset_id="MAX",
        organization_id=test_org.organization_id,
        name="Max Test", infrastructure_type="coastal")

    insp_id = seed_inspection(db_session, asset_id="MAX",
        organization_id=test_org.organization_id,
        inspection_date=date(2024, 8, 1), severity="S1")

    # Add additional images + detections under the same inspection,
    # at higher severities. UUIDs ensure each image row has a unique
    # primary key even when severities repeat.
    import uuid as _uuid
    for sev in ("S2", "S3", "S2"):
        img_id = str(_uuid.uuid4())
        db_session.add(Image(
            id=img_id, organization_id=test_org.organization_id,
            inspection_id=insp_id, filename=f"{sev}.jpg",
        ))
        db_session.add(Detection(
            image_id=img_id, organization_id=test_org.organization_id,
            severity=sev, damage_type="corrosion",
        ))
    db_session.commit()

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id
    )
    rows = df[df["asset_id"] == "MAX"]
    assert len(rows) == 1, "should aggregate to 1 row per inspection"
    assert rows.iloc[0]["severity_score"] == "S3", \
        "max severity across S1/S2/S3/S2 must be S3"


# ─── fail-fast on missing org_id ──────────────────────────────────

@pytest.mark.parametrize("bad", [None, "", 0])
def test_missing_organization_id_raises(db_session, bad):
    with pytest.raises(ValueError):
        build_analytics_dataframe(db_session, organization_id=bad)


# ─── engineer review flow: status + verified-set handling ─────────

def _add_image_with_detection(db, *, org_id, inspection_id, severity, det_id=None):
    """Helper: add one image + one CV detection, return the detection id."""
    import uuid as _uuid
    img_id = str(_uuid.uuid4())
    det_id = det_id or str(_uuid.uuid4())
    db.add(Image(
        id=img_id, organization_id=org_id,
        inspection_id=inspection_id, filename=f"{severity}.jpg",
    ))
    db.add(Detection(
        id=det_id, image_id=img_id, organization_id=org_id,
        severity=severity, damage_type="corrosion",
        source="cv_model", is_locked=True,
    ))
    return img_id, det_id


def test_reviewed_inspection_is_included(db_session, test_org):
    """A review_completed inspection must still feed analytics — regression for
    the bug where only status=='completed' was queried, so any reviewed
    inspection silently dropped out ('0 assets analysed')."""
    import uuid as _uuid
    seed_asset(db_session, asset_id="REV",
        organization_id=test_org.organization_id,
        name="Reviewed Pier", infrastructure_type="pier")
    insp_id = str(_uuid.uuid4())
    db_session.add(Inspection(
        id=insp_id, organization_id=test_org.organization_id,
        asset_id="REV", inspection_date=date(2024, 3, 1),
        status="review_completed", name="Reviewed", inspector_name="T",
    ))
    _add_image_with_detection(
        db_session, org_id=test_org.organization_id,
        inspection_id=insp_id, severity="S3")
    db_session.commit()

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id)
    rows = df[df["asset_id"] == "REV"]
    assert len(rows) == 1
    assert rows.iloc[0]["severity_score"] == "S3"


def test_rejected_and_modified_cv_detections_excluded(db_session, test_org):
    """Analytics uses the verified set: a rejected CV detection and a modified
    CV original are dropped; the accepted one (and any engineer copy) survive."""
    import uuid as _uuid
    from app.models.detection_review import DetectionReview

    seed_asset(db_session, asset_id="VER",
        organization_id=test_org.organization_id,
        name="Verified Pier", infrastructure_type="pier")
    insp_id = str(_uuid.uuid4())
    db_session.add(Inspection(
        id=insp_id, organization_id=test_org.organization_id,
        asset_id="VER", inspection_date=date(2024, 4, 1),
        status="review_completed", name="Verified", inspector_name="T",
    ))
    # Accepted S2, rejected S4 (the worst — must be excluded so max is S2)
    _, accepted_id = _add_image_with_detection(
        db_session, org_id=test_org.organization_id,
        inspection_id=insp_id, severity="S2")
    rej_img_id, rejected_id = _add_image_with_detection(
        db_session, org_id=test_org.organization_id,
        inspection_id=insp_id, severity="S4")
    db_session.add(DetectionReview(
        organization_id=test_org.organization_id, image_id=rej_img_id,
        inspection_id=insp_id, cv_detection_id=rejected_id,
        action="rejected",
    ))
    db_session.commit()

    df = build_analytics_dataframe(
        db_session, organization_id=test_org.organization_id)
    rows = df[df["asset_id"] == "VER"]
    assert len(rows) == 1
    assert rows.iloc[0]["severity_score"] == "S2", \
        "rejected S4 must be excluded, leaving accepted S2 as the max"
