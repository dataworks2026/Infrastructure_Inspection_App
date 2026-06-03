"""
Integration tests for the /api/v1/predictive/* router.

Exercises every endpoint with FastAPI's TestClient against the
in-memory SQLite fixture set up in conftest.py:

  POST   /api/v1/predictive/run
  GET    /api/v1/predictive/runs
  GET    /api/v1/predictive/runs/{run_id}
  GET    /api/v1/predictive/assets/{asset_id}
  GET    /api/v1/predictive/latest

Covers happy paths, 404 paths, empty-org behaviour, multi-tenant
isolation, and unauthenticated requests.
"""

from datetime import date

import pytest

from app.models.v1_analytics_item   import V1AnalyticsItem
from app.models.v1_analytics_reason import V1AnalyticsReason
from app.models.v1_analytics_run    import V1AnalyticsRun

from tests.conftest import seed_asset, seed_inspection


# ─── Test data helpers ────────────────────────────────────────────

def _seed_three_inspection_asset(db, org_id, asset_id, name, infra="coastal"):
    """Seed an asset with 3 worsening inspections (S1 -> S2 -> S3) so
    the engine produces a meaningful trend."""
    seed_asset(db, asset_id=asset_id, organization_id=org_id,
        name=name, infrastructure_type=infra)
    seed_inspection(db, asset_id=asset_id, organization_id=org_id,
        inspection_date=date(2024, 1, 1), severity="S1")
    seed_inspection(db, asset_id=asset_id, organization_id=org_id,
        inspection_date=date(2024, 7, 1), severity="S2")
    seed_inspection(db, asset_id=asset_id, organization_id=org_id,
        inspection_date=date(2025, 1, 1), severity="S3")


# ─── POST /run ────────────────────────────────────────────────────

def test_post_run_succeeds_and_persists(db_session, test_org, client):
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A1", "Pier A")
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A2", "Bridge B", infra="bridge")

    resp = client.post("/api/v1/predictive/run")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"]               == "completed"
    assert body["total_items_analyzed"] == 2
    assert body["run_id"]
    assert "completed" in body["message"]

    # Run row was persisted with the right shape.
    run = (
        db_session.query(V1AnalyticsRun)
        .filter(V1AnalyticsRun.id == body["run_id"]).one()
    )
    assert run.organization_id == test_org.organization_id
    assert run.engine_version  == "1.0"
    assert run.schema_version  == "v3"
    assert run.run_metadata is not None
    assert run.run_metadata.get("config_file") == "thresholds.yaml"

    # 1 V1AnalyticsItem per asset.
    items = db_session.query(V1AnalyticsItem) \
        .filter(V1AnalyticsItem.analytics_run_id == run.id).all()
    assert len(items) == 2

    # >=3 reason rows per item (deterioration + tti + current_severity,
    # plus optional anomaly).
    reasons = db_session.query(V1AnalyticsReason).all()
    assert len(reasons) >= 6


def test_post_run_with_no_data_completes_gracefully(db_session, test_org, client):
    """Empty org -> should still complete, total_items_analyzed = 0."""
    resp = client.post("/api/v1/predictive/run")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"]               == "completed"
    assert body["total_items_analyzed"] == 0


# ─── GET /runs ────────────────────────────────────────────────────

def test_get_runs_lists_newest_first(db_session, test_org, client):
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A1", "Pier A")

    # Two runs back-to-back.
    client.post("/api/v1/predictive/run")
    client.post("/api/v1/predictive/run")

    resp = client.get("/api/v1/predictive/runs")
    assert resp.status_code == 200
    runs = resp.json()
    assert len(runs) == 2
    # Newest first.
    assert runs[0]["created_at"] >= runs[1]["created_at"]


# ─── GET /runs/{run_id} ───────────────────────────────────────────

def test_get_run_detail_returns_full_payload(db_session, test_org, client):
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A1", "Pier A")
    run_id = client.post("/api/v1/predictive/run").json()["run_id"]

    resp = client.get(f"/api/v1/predictive/runs/{run_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"]     == run_id
    assert body["status"] == "completed"
    assert len(body["results"]) == 1

    asset = body["results"][0]
    assert asset["asset_id"] == "A1"
    assert asset["asset_name"] == "Pier A"
    assert "trend_direction" in asset
    assert "priority_score"  in asset
    assert "tti_label"       in asset
    # severity_history + reasons should both be populated.
    assert isinstance(asset["severity_history"], list)
    assert len(asset["severity_history"]) == 3
    assert isinstance(asset["reasons"], list)
    assert len(asset["reasons"]) >= 3


def test_get_run_detail_404_for_unknown_id(client):
    resp = client.get("/api/v1/predictive/runs/does-not-exist")
    assert resp.status_code == 404


# ─── GET /latest ──────────────────────────────────────────────────

def test_get_latest_returns_most_recent_completed(db_session, test_org, client):
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A1", "Pier A")
    first  = client.post("/api/v1/predictive/run").json()["run_id"]
    second = client.post("/api/v1/predictive/run").json()["run_id"]

    # SQLite's func.now() only has second-level precision so two
    # back-to-back inserts tie on created_at. Force a measurable
    # timestamp gap so the ORDER BY ... DESC LIMIT 1 is deterministic
    # in tests. Production (Postgres) has microsecond precision and
    # does not need this.
    from datetime import datetime, timedelta
    db_session.query(V1AnalyticsRun) \
        .filter(V1AnalyticsRun.id == second) \
        .update({"created_at": datetime.utcnow() + timedelta(hours=1)})
    db_session.commit()

    resp = client.get("/api/v1/predictive/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == second, "latest should be the most recent run"
    assert body["id"] != first


def test_get_latest_404_when_no_runs(client):
    resp = client.get("/api/v1/predictive/latest")
    assert resp.status_code == 404


# ─── GET /assets/{asset_id} ───────────────────────────────────────

def test_get_asset_latest_returns_single_asset(db_session, test_org, client):
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A1", "Pier A")
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A2", "Bridge B", infra="bridge")
    client.post("/api/v1/predictive/run")

    resp = client.get("/api/v1/predictive/assets/A1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["asset_id"]   == "A1"
    assert body["asset_name"] == "Pier A"
    assert "priority_score" in body
    assert isinstance(body["reasons"], list)


def test_get_asset_latest_404_when_no_run_yet(client):
    resp = client.get("/api/v1/predictive/assets/anything")
    assert resp.status_code == 404


def test_get_asset_latest_404_for_unknown_asset_after_run(db_session, test_org, client):
    _seed_three_inspection_asset(db_session, test_org.organization_id,
        "A1", "Pier A")
    client.post("/api/v1/predictive/run")

    resp = client.get("/api/v1/predictive/assets/never-existed")
    assert resp.status_code == 404


# ─── auth ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("path,method", [
    ("/api/v1/predictive/run",            "POST"),
    ("/api/v1/predictive/runs",           "GET"),
    ("/api/v1/predictive/latest",         "GET"),
    ("/api/v1/predictive/runs/abc",       "GET"),
    ("/api/v1/predictive/assets/abc",     "GET"),
])
def test_endpoints_require_auth(unauthed_client, path, method):
    if method == "POST":
        resp = unauthed_client.post(path)
    else:
        resp = unauthed_client.get(path)
    assert resp.status_code == 401, \
        f"{method} {path} should return 401 without auth"


# ─── multi-tenant isolation ───────────────────────────────────────

def test_user_cannot_see_other_orgs_runs(db_session, test_org, other_org, client):
    """An analytics run that belongs to a different org must not show
    up in any of the listing or detail endpoints, even if its run_id
    is known."""
    foreign_run = V1AnalyticsRun(
        id                   = "foreign-run-1",
        organization_id      = other_org.organization_id,
        status               = "completed",
        engine_version       = "1.0",
        schema_version       = "v2",
        total_items_analyzed = 0,
    )
    db_session.add(foreign_run)
    db_session.commit()

    # GET /runs must not include it.
    resp = client.get("/api/v1/predictive/runs")
    assert resp.status_code == 200
    assert all(r["id"] != "foreign-run-1" for r in resp.json())

    # GET /runs/{id} must 404 for the foreign run.
    resp = client.get("/api/v1/predictive/runs/foreign-run-1")
    assert resp.status_code == 404
