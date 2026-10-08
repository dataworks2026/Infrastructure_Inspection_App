"""Stage 2 to 4 through the API: run over reviewed findings, approve and
reject behind the role check, library with CSV import, letterhead, the
reopen hook, and the projection into maintenance_recommendations.
"""
import io

from PIL import Image as PILImage

from app.core.config import settings
from app.models.inspection import InspectionStatus
from app.models.maintenance_recommendation import MaintenanceRecommendation
from app.services.recommendations.audit import list_audit_events
from tests.recommendations.conftest import TEST_PRODUCER
from tests.recommendations.test_stage2_feed import _det, _inspection, _review


def _reviewed_inspection(db, org_id, suffix):
    insp, img = _inspection(db, org_id, suffix=suffix)
    a = _det(db, img, f"cv-{suffix}-1", "Corrosion", "S4")
    b = _det(db, img, f"cv-{suffix}-2", "Corrosion", "S4")
    c = _det(db, img, f"cv-{suffix}-3", "Decay", "S2")
    for d in (a, b, c):
        _review(db, insp, img, "accepted", cv=d.id)
    db.commit()
    return insp


def _rule(client, **over):
    body = {"producer": TEST_PRODUCER, "detection_class": "corrosion", "severity": 4,
            "recommendation_text": "Weld a plate within 30 days.", "action_class": "structural repair"}
    body.update(over)
    r = client.post("/api/v1/recommendations/library", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_run_approve_reject_and_projection(client, db_session, test_org, test_user, rec_vocab, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    org = test_org.organization_id
    insp = _reviewed_inspection(db_session, org, "run")
    _rule(client)

    r = client.post(f"/api/v1/recommendations/inspections/{insp.id}/run", json={"producer": TEST_PRODUCER})
    assert r.status_code == 200, r.text
    body = r.json()
    run = body["run"]
    assert run["total_detections"] == 3 and run["total_matched"] == 2 and run["total_unmatched"] == 1
    assert run["total_matched"] + run["total_unmatched"] + run["total_dismissed"] + run["total_skipped"] == run["total_detections"]
    assert body["records"] == {"Draft": 1, "Needs Recommendation": 1}
    assert body["rerun"] is False

    recs = client.get(f"/api/v1/recommendations/records?inspection_id={insp.id}").json()
    draft = next(x for x in recs if x["status"] == "Draft")
    assert draft["detections"] == 2 and draft["severity"] == ["S4"]

    r = client.post(f"/api/v1/recommendations/records/{draft['id']}/approve")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Approved"
    mrid = r.json()["maintenance_recommendation_id"]
    assert mrid
    row = db_session.query(MaintenanceRecommendation).filter(MaintenanceRecommendation.recommendation_id == mrid).first()
    assert row.priority == "immediate" and row.status == "approved" and row.asset_id == insp.asset_id
    assert row.alternative_options["record_id"] == draft["id"]
    assert row.description == "Weld a plate within 30 days."

    # approving twice is refused, not silently repeated
    r = client.post(f"/api/v1/recommendations/records/{draft['id']}/approve")
    assert r.status_code == 409

    # a second run on the same inspection is a rerun and keeps the approved record
    r = client.post(f"/api/v1/recommendations/inspections/{insp.id}/run", json={"producer": TEST_PRODUCER})
    assert r.status_code == 200 and r.json()["rerun"] is True
    recs = client.get(f"/api/v1/recommendations/records?inspection_id={insp.id}").json()
    assert any(x["id"] == draft["id"] and x["status"] == "Approved" for x in recs)

    # output and PDF follow from the approval
    out = client.get("/api/v1/recommendations/output").json()
    assert out["summary"]["approved_counts_by_tier"] == {"1": 1}
    pdf = client.get(f"/api/v1/recommendations/inspections/{insp.id}/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_engineer_gate_and_role_refusal(client, db_session, test_org, test_user, rec_vocab):
    org = test_org.organization_id
    insp, img = _inspection(db_session, org, status=InspectionStatus.completed.value, suffix="gate")
    _det(db_session, img, "cv-gate-1", "Corrosion", "S4")
    db_session.commit()
    _rule(client)

    r = client.post(f"/api/v1/recommendations/inspections/{insp.id}/run", json={"producer": TEST_PRODUCER})
    assert r.status_code == 409, "unreviewed inspection: the engine does not run"

    r = client.post(f"/api/v1/recommendations/inspections/{insp.id}/run", json={"producer": TEST_PRODUCER, "allow_unreviewed": True})
    assert r.status_code == 200
    assert any(e.action == "resolution_run_unreviewed" for e in list_audit_events(db_session, org))

    draft = next(x for x in client.get("/api/v1/recommendations/records").json() if x["status"] == "Draft")
    test_user.role = "viewer"
    db_session.commit()
    r = client.post(f"/api/v1/recommendations/records/{draft['id']}/approve")
    assert r.status_code == 403
    refusal = [e for e in list_audit_events(db_session, org) if e.action == "action_refused"]
    assert refusal and refusal[-1].detail["role"] == "viewer" and refusal[-1].detail["action"] == "approve"
    assert client.get("/api/v1/recommendations/overview").json()["can_review"] is False
    test_user.role = "analyst"
    db_session.commit()


def test_library_crud_and_csv_import(client, db_session, test_org, rec_vocab):
    e = _rule(client, detection_class="spalling", severity=3, recommendation_text="Patch and seal.", action_class="concrete repair")
    assert e["derived_tier"] == 2
    r = client.put(f"/api/v1/recommendations/library/{e['entry_id']}", json={
        "producer": TEST_PRODUCER, "detection_class": "spalling", "severity": 3,
        "recommendation_text": "Patch, seal and photograph.", "action_class": "concrete repair"})
    assert r.status_code == 200 and r.json()["version"] == 2
    hist = client.get(f"/api/v1/recommendations/library/{e['entry_id']}/history").json()
    assert [h["version"] for h in hist] == [1, 2]
    assert len(client.get("/api/v1/recommendations/library").json()) == 1

    csv_ok = ("detection_class,severity,recommendation_text,action_class,asset_type,asset_id,tier_override,producer\n"
              f"cracking,4,Install crack monitors.,structural assessment,,,,{TEST_PRODUCER}\n"
              f"decay,2,Monitor at next inspection.,monitoring,,,,{TEST_PRODUCER}\n")
    r = client.post("/api/v1/recommendations/library/import", files={"file": ("rules.csv", csv_ok, "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2
    assert len(client.get("/api/v1/recommendations/library").json()) == 3

    csv_bad = ("detection_class,severity,recommendation_text,action_class\n"
               "corrosion,4,Good row.,coating\n"
               "rust staining,4,Not in the vocabulary.,coating\n"
               "corrosion,9,Bad severity.,coating\n")
    r = client.post("/api/v1/recommendations/library/import", files={"file": ("rules.csv", csv_bad, "text/csv")})
    assert r.status_code == 422
    problems = r.json()["detail"]["problems"]
    assert [p["row"] for p in problems] == [3, 4]
    assert len(client.get("/api/v1/recommendations/library").json()) == 3, "all or nothing: the good row was not written"

    r = client.delete(f"/api/v1/recommendations/library/{e['entry_id']}")
    assert r.status_code == 200
    assert len(client.get("/api/v1/recommendations/library").json()) == 2
    assert len(client.get("/api/v1/recommendations/library?include_archived=true").json()) == 3


def test_letterhead_and_logo(client, db_session, test_org, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    r = client.get("/api/v1/recommendations/letterhead")
    assert r.status_code == 200 and r.json()["firm_name"] == test_org.name
    r = client.put("/api/v1/recommendations/letterhead", json={"firm_name": "Demo Engineering", "client_name": "Demo Client", "email": "x@y.z"})
    assert r.status_code == 200 and r.json()["firm_name"] == "Demo Engineering"
    buf = io.BytesIO(); PILImage.new("RGB", (20, 10), "teal").save(buf, format="PNG"); buf.seek(0)
    r = client.post("/api/v1/recommendations/letterhead/logo", files={"file": ("logo.png", buf.read(), "image/png")})
    assert r.status_code == 200, r.text
    assert r.json()["logo_url"].endswith("/logo.png")
    assert (tmp_path / "letterhead" / test_org.organization_id / "logo.png").exists()
    again = client.get("/api/v1/recommendations/letterhead").json()
    assert again["client_name"] == "Demo Client" and again["logo_path"].startswith("letterhead/")


def test_reopen_supersedes_and_marks_projection(client, db_session, test_org, test_user, rec_vocab, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    org = test_org.organization_id
    insp = _reviewed_inspection(db_session, org, "reopen")
    _rule(client)
    assert client.post(f"/api/v1/recommendations/inspections/{insp.id}/run", json={"producer": TEST_PRODUCER}).status_code == 200
    draft = next(x for x in client.get(f"/api/v1/recommendations/records?inspection_id={insp.id}").json() if x["status"] == "Draft")
    approved = client.post(f"/api/v1/recommendations/records/{draft['id']}/approve").json()
    mrid = approved["maintenance_recommendation_id"]

    r = client.post(f"/api/v1/inspections/{insp.id}/reopen-review")
    assert r.status_code == 422, "an inspection with recommendations cannot be reopened without a reason"

    r = client.post(f"/api/v1/inspections/{insp.id}/reopen-review", json={"reason": "wrong severity on two findings"})
    assert r.status_code == 200, r.text
    recs = {x["id"]: x for x in client.get(f"/api/v1/recommendations/records?inspection_id={insp.id}").json()}
    assert recs[draft["id"]]["status"] == "Superseded"
    assert recs[draft["id"]]["supersede_reason"] == "inspection_reopened"
    row = db_session.query(MaintenanceRecommendation).filter(MaintenanceRecommendation.recommendation_id == mrid).first()
    db_session.refresh(row)
    assert row.status == "superseded"
