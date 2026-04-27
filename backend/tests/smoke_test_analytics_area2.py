"""
Smoke test for the predictive analytics backend (Areas 2, 3, 4).

Exercises, in order:
  1. data_adapter.build_analytics_dataframe         (Area 2)
  2. engine.run_pipeline_from_dataframe              (Area 2)
  3. Adapter + engine edge cases                     (Area 2.3)
  4. result_mapper.save_analytics_items + reasons    (Area 4)

Uses an in-memory SQLite database with seeded test data so it does
NOT touch the real app database. Not a pytest file — runs as a
plain script. Intended as a manual verification tool during
backend development; will be superseded by proper pytest suites
in Area 9.

Run from anywhere:
  python3 backend/tests/smoke_test_analytics_area2.py
  (or)  cd backend && python3 tests/smoke_test_analytics_area2.py
"""

import os
import sys
import uuid
from datetime import date

# Make sure "app.*" resolves when running this file directly, without
# relying on the caller's current working directory. The backend/
# directory is one level above this file's tests/ folder.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Importing Base + app.models registers every table with the metadata.
from app.database import Base
import app.models  # noqa: F401 — registers all models on Base

from app.models.asset      import Asset
from app.models.detection  import Detection
from app.models.image      import Image
from app.models.inspection import Inspection

from app.services.analytics.data_adapter import build_analytics_dataframe
from app.services.analytics.engine       import run_pipeline_from_dataframe


ORG = "test-org-1"


def banner(text: str) -> None:
    print("=" * 70)
    print(text)
    print("=" * 70)


def _seed_inspection(db, asset_id: str, inspection_date: date, severity: str) -> None:
    """Create one completed Inspection with one Image and one Detection."""
    insp_id = str(uuid.uuid4())
    img_id  = str(uuid.uuid4())
    db.add(Inspection(
        id              = insp_id,
        organization_id = ORG,
        asset_id        = asset_id,
        inspection_date = inspection_date,
        status          = "completed",
    ))
    db.add(Image(
        id              = img_id,
        organization_id = ORG,
        inspection_id   = insp_id,
        filename        = "test.jpg",
    ))
    db.add(Detection(
        image_id        = img_id,
        organization_id = ORG,
        severity        = severity,
    ))


def main() -> int:
    # ── 1. Spin up an in-memory SQLite DB ──────────────────────
    engine   = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(engine)
    Session  = sessionmaker(bind=engine)
    db       = Session()

    # ── 2. Seed test data ───────────────────────────────────────
    # Asset A: coastal, severity worsening S2 → S3 → S4
    db.add(Asset(
        id                  = "asset-a",
        organization_id     = ORG,
        name                = "Test Pier A",
        infrastructure_type = "coastal",
    ))
    _seed_inspection(db, "asset-a", date(2024, 3, 1), "S2")
    _seed_inspection(db, "asset-a", date(2024, 9, 1), "S3")
    _seed_inspection(db, "asset-a", date(2025, 3, 1), "S4")

    # Asset B: bridge, severity improving S4 → S3 → S2
    db.add(Asset(
        id                  = "asset-b",
        organization_id     = ORG,
        name                = "Test Bridge B",
        infrastructure_type = "bridge",
    ))
    _seed_inspection(db, "asset-b", date(2024, 3, 1), "S4")
    _seed_inspection(db, "asset-b", date(2024, 9, 1), "S3")
    _seed_inspection(db, "asset-b", date(2025, 3, 1), "S2")

    # Asset C: belongs to a DIFFERENT org — must NOT show up in ORG query
    db.add(Asset(
        id                  = "asset-c",
        organization_id     = "other-org",
        name                = "Leaked Asset",
        infrastructure_type = "pier",
    ))
    # Add an inspection for asset-c but under "other-org" so it is
    # not supposed to appear when we query for ORG.
    other_insp_id = str(uuid.uuid4())
    other_img_id  = str(uuid.uuid4())
    db.add(Inspection(
        id              = other_insp_id,
        organization_id = "other-org",
        asset_id        = "asset-c",
        inspection_date = date(2024, 3, 1),
        status          = "completed",
    ))
    db.add(Image(
        id              = other_img_id,
        organization_id = "other-org",
        inspection_id   = other_insp_id,
        filename        = "leak.jpg",
    ))
    db.add(Detection(
        image_id        = other_img_id,
        organization_id = "other-org",
        severity        = "S4",
    ))

    # Edge-case assets under the main ORG:

    # Asset D — single inspection. The engine should include it and
    # classify it as "stable" (no rate calculable from one point).
    db.add(Asset(
        id                  = "asset-d",
        organization_id     = ORG,
        name                = "Solo Inspection Asset",
        infrastructure_type = "pier",
    ))
    _seed_inspection(db, "asset-d", date(2024, 6, 1), "S3")

    # Asset E — inspection exists but no detections. Should NOT
    # appear in the DataFrame (inner join drops it).
    db.add(Asset(
        id                  = "asset-e",
        organization_id     = ORG,
        name                = "No Detections Asset",
        infrastructure_type = "coastal",
    ))
    db.add(Inspection(
        id              = str(uuid.uuid4()),
        organization_id = ORG,
        asset_id        = "asset-e",
        inspection_date = date(2024, 6, 1),
        status          = "completed",
    ))
    # Notice: no Image / Detection for asset-e on purpose.

    # Asset F — detection exists but severity is NULL. Should be
    # filtered out so it does not reach the analytics engine
    # (the engine cannot map NULL into the 1..4 scale).
    db.add(Asset(
        id                  = "asset-f",
        organization_id     = ORG,
        name                = "Null Severity Asset",
        infrastructure_type = "bridge",
    ))
    asset_f_insp = str(uuid.uuid4())
    asset_f_img  = str(uuid.uuid4())
    db.add(Inspection(
        id              = asset_f_insp,
        organization_id = ORG,
        asset_id        = "asset-f",
        inspection_date = date(2024, 6, 1),
        status          = "completed",
    ))
    db.add(Image(
        id              = asset_f_img,
        organization_id = ORG,
        inspection_id   = asset_f_insp,
        filename        = "null_sev.jpg",
    ))
    db.add(Detection(
        image_id        = asset_f_img,
        organization_id = ORG,
        severity        = None,
    ))

    db.commit()

    # ── 3. data_adapter ─────────────────────────────────────────
    banner("STEP 1: build_analytics_dataframe(db, organization_id='test-org-1')")
    df = build_analytics_dataframe(db, organization_id=ORG)
    print(df.to_string())
    print()

    # Expected rows:
    #   asset-a × 3 inspections = 3
    #   asset-b × 3 inspections = 3
    #   asset-d × 1 inspection  = 1
    #   asset-e (no detections) = 0 (inner join drops)
    #   asset-f (null severity) = 0 (filter drops)
    #   other-org assets        = 0 (org isolation)
    # Total = 7
    assert len(df) == 7, f"expected 7 rows, got {len(df)}"
    assert set(df["asset_id"]) == {"asset-a", "asset-b", "asset-d"}, \
        f"unexpected asset_id set in output: {set(df['asset_id'])}"
    print("[check] row count = 7                                  OK")
    print("[check] cross-org data excluded                         OK")
    print("[check] asset with no detections excluded               OK")
    print("[check] detection with null severity excluded           OK")
    print("[check] single-inspection asset included                OK")

    # ── 4. run_pipeline_from_dataframe ──────────────────────────
    banner("STEP 2: run_pipeline_from_dataframe(df)")
    output = run_pipeline_from_dataframe(df)

    banner("FINAL OUTPUT (V2 schema)")
    print(output.to_string())
    print()

    # Sanity: should rank 3 assets (a, b, d). Worsening asset-a first.
    # asset-d has only one inspection so the engine treats it as stable.
    assert len(output) == 3, f"expected 3 assets in output, got {len(output)}"
    assert output.iloc[0]["asset_id"] == "asset-a", \
        "worsening asset should be ranked #1"
    assert set(output["asset_id"]) == {"asset-a", "asset-b", "asset-d"}
    print("[check] 3 assets ranked                                 OK")
    print("[check] worsening asset ranked first                    OK")

    # ── 5. Edge-case paths ──────────────────────────────────────
    banner("STEP 3: edge-case verifications")

    # (a) Empty org — query returns a frame with zero rows but the
    #     correct column schema (never None, never a crash).
    from app.services.analytics.data_adapter import EXPECTED_COLUMNS
    empty_df = build_analytics_dataframe(db, organization_id="ghost-org")
    assert len(empty_df) == 0, "expected zero rows for an unknown org"
    assert list(empty_df.columns) == EXPECTED_COLUMNS, \
        f"empty-org DataFrame has wrong columns: {list(empty_df.columns)}"
    print("[check] empty-org query -> empty DataFrame w/ schema    OK")

    # (b) Empty input to the engine — must short-circuit and return
    #     a V2-shaped DataFrame with zero rows, not raise.
    from app.services.analytics.engine import V2_OUTPUT_COLUMNS
    empty_output = run_pipeline_from_dataframe(empty_df)
    assert len(empty_output) == 0, "expected zero rows in empty output"
    assert list(empty_output.columns) == V2_OUTPUT_COLUMNS, \
        f"empty output has wrong columns: {list(empty_output.columns)}"
    print("[check] empty DataFrame -> empty V2 output              OK")

    # (c) Missing org_id must fail loudly. Silently returning empty
    #     would mask a caller bug and risks cross-org data leakage.
    for bad_org in (None, "", 0):
        try:
            build_analytics_dataframe(db, organization_id=bad_org)
        except ValueError:
            continue
        raise AssertionError(
            f"expected ValueError for organization_id={bad_org!r}"
        )
    print("[check] missing organization_id raises ValueError       OK")

    # ── 6. Persistence mapper (Area 4) ─────────────────────────
    banner("STEP 4: result_mapper end-to-end persistence")

    from app.models.v1_analytics_item   import V1AnalyticsItem
    from app.models.v1_analytics_reason import V1AnalyticsReason
    from app.models.v1_analytics_run    import V1AnalyticsRun
    from app.services.analytics.engine  import load_config
    from app.services.analytics.result_mapper import (
        save_analytics_items,
        save_analytics_reasons,
    )

    config = load_config()

    run = V1AnalyticsRun(
        organization_id      = ORG,
        status               = "running",
        engine_version       = "1.0",
        schema_version       = "v2",
        total_items_analyzed = 0,
    )
    db.add(run)
    db.flush()

    saved = save_analytics_items(db, run, output, df)
    for item, row in saved:
        save_analytics_reasons(db, item, row, config)

    run.status               = "completed"
    run.total_items_analyzed = len(output)
    db.commit()

    # --- assertions on V1AnalyticsItem ---
    items = (
        db.query(V1AnalyticsItem)
          .filter(V1AnalyticsItem.analytics_run_id == run.id)
          .all()
    )
    assert len(items) == 3, f"expected 3 item rows, got {len(items)}"
    print("[check] 3 V1AnalyticsItem rows persisted                OK")

    items_by_id = {i.asset_id: i for i in items}

    # asset-a: 3 inspections, S2 -> S3 -> S4, worsening
    a = items_by_id["asset-a"]
    assert a.status == "worsening",   f"asset-a status = {a.status}"
    assert a.severity_now == "S4",    f"asset-a severity_now = {a.severity_now}"
    assert a.severity_prev == "S3",   f"asset-a severity_prev = {a.severity_prev}"
    assert a.priority_rank == 1,      "asset-a should be ranked #1"
    assert a.recommended_action == "escalate", a.recommended_action
    # Date math: (2025-03-01) - (2024-03-01) = 365 days
    assert a.days_since_baseline == 365, a.days_since_baseline
    assert a.item_metadata.get("asset_type") == "coastal"
    assert a.item_metadata.get("priority_label") in {"Critical", "High", "Medium"}
    print("[check] asset-a item mapped fully + correctly            OK")

    # asset-b: 3 inspections, S4 -> S3 -> S2, improving
    b = items_by_id["asset-b"]
    assert b.status == "resolved",    f"asset-b status = {b.status}"
    assert b.severity_now == "S2",    f"asset-b severity_now = {b.severity_now}"
    assert b.severity_prev == "S3",   f"asset-b severity_prev = {b.severity_prev}"
    assert b.days_since_baseline == 365
    print("[check] asset-b (improving) item mapped correctly        OK")

    # asset-d: single inspection — severity_prev + days_since_baseline
    # must both be NULL because there is no prior data to compare against.
    d = items_by_id["asset-d"]
    assert d.severity_prev is None,          d.severity_prev
    assert d.days_since_baseline is None,    d.days_since_baseline
    assert d.severity_now == "S3"
    assert d.status == "persistent",         d.status
    print("[check] asset-d (single inspection) handled correctly   OK")

    # --- assertions on V1AnalyticsReason ---
    reasons = (
        db.query(V1AnalyticsReason)
          .filter(V1AnalyticsReason.analytics_item_id.in_([i.id for i in items]))
          .all()
    )
    # 3 mandatory reasons (deterioration + tti + current_severity)
    # per item. Anomalies in this seed are unlikely (severity jumps
    # of 1 with coastal threshold = 2), so no 4th reason row.
    assert len(reasons) == 9, f"expected 9 reason rows, got {len(reasons)}"
    print("[check] 9 V1AnalyticsReason rows persisted (3 per item) OK")

    # Codes should exactly match the ClickUp spec for the 3 mandatory
    # reasons, and each item should have one of each.
    for item in items:
        item_reasons = [r for r in reasons if r.analytics_item_id == item.id]
        codes = sorted(r.reason_code for r in item_reasons)
        assert codes == ["current_severity", "deterioration", "tti"], (
            f"{item.asset_id}: unexpected reason codes {codes}"
        )
    print("[check] every item has deterioration+tti+current_severity OK")

    # Weight must come from thresholds.yaml per asset_type.
    coastal_weights = config["coastal"]["priority_weights"]
    bridge_weights  = config["bridge"]["priority_weights"]
    pier_weights    = config["pier"]["priority_weights"]

    for item in items:
        atype = item.item_metadata.get("asset_type")
        expected = {
            "coastal": coastal_weights,
            "bridge":  bridge_weights,
            "pier":    pier_weights,
        }[atype]

        item_reasons = {r.reason_code: r for r in reasons if r.analytics_item_id == item.id}
        assert item_reasons["deterioration"].weight == expected["deterioration_rate"], \
            f"{item.asset_id} deterioration weight mismatch"
        assert item_reasons["current_severity"].weight == expected["current_severity"], \
            f"{item.asset_id} severity weight mismatch"
        assert item_reasons["tti"].weight is None, \
            f"{item.asset_id} tti weight should be NULL"
    print("[check] reason weights resolve per asset_type           OK")

    banner("Smoke test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
