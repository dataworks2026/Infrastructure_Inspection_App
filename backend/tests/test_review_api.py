"""
API tests for the Engineer Review Flow endpoints (app/routers/review.py).

Endpoints under test:
- POST /api/v1/inspections/{id}/start-review
- POST /api/v1/images/{id}/submit-review
- POST /api/v1/inspections/{id}/complete-review
- GET  /api/v1/inspections/{id}/review-diff

Uses the shared conftest fixtures (in-memory SQLite + TestClient with
get_db / get_current_user overridden).
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.core.deps import get_db, get_current_user
from app.core.security import hash_password
from app.main import app as fastapi_app
from fastapi.testclient import TestClient

from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection
from app.models.user import User

from tests.conftest import seed_asset


# ─── Seeding fixtures ─────────────────────────────────────────────

@pytest.fixture
def review_data(db_session, test_org):
    """Asset → completed inspection → 2 images → 4 CV detections.

    image1: det_a (corrosion S2), det_b (crack S2), det_c (corrosion S2)
    image2: det_d (crack S2)
    """
    org_id = test_org.organization_id
    seed_asset(db_session, asset_id="asset-r1", organization_id=org_id, name="Pier 9")

    insp_id = str(uuid.uuid4())
    db_session.add(Inspection(
        id=insp_id,
        organization_id=org_id,
        asset_id="asset-r1",
        inspection_date=date(2026, 6, 1),
        status="completed",
        name="Review Test Inspection",
        inspector_name="Test Inspector",
    ))

    img1, img2 = str(uuid.uuid4()), str(uuid.uuid4())
    for img_id, fname in ((img1, "img1.jpg"), (img2, "img2.jpg")):
        db_session.add(Image(
            id=img_id,
            organization_id=org_id,
            inspection_id=insp_id,
            filename=fname,
            upload_completed=True,
            analysis_status="completed",
        ))

    def _det(image_id, damage_type):
        d = Detection(
            id=str(uuid.uuid4()),
            image_id=image_id,
            organization_id=org_id,
            infrastructure_type="coastal",
            damage_type=damage_type,
            severity="S2",
            confidence=0.8,
            confidence_score=0.8,
            bbox_x1=10.0, bbox_y1=20.0, bbox_x2=110.0, bbox_y2=120.0,
            model_name="yolov8-maritime",
        )
        db_session.add(d)
        return d

    det_a = _det(img1, "corrosion")
    det_b = _det(img1, "crack")
    det_c = _det(img1, "corrosion")
    det_d = _det(img2, "crack")
    db_session.commit()

    return {
        "inspection_id": insp_id,
        "img1": img1,
        "img2": img2,
        "det_a": det_a.id,
        "det_b": det_b.id,
        "det_c": det_c.id,
        "det_d": det_d.id,
    }


@pytest.fixture
def other_org_client(db_session, other_org, test_user):
    """TestClient authenticated as a user from a DIFFERENT org.
    Used to verify cross-org isolation (404s)."""
    other_user = User(
        id="other-user-1",
        organization_id=other_org.organization_id,
        email="intruder@example.com",
        full_name="Other Org User",
        hashed_password=hash_password("testpass"),
        role="analyst",
        is_active=True,
    )
    db_session.add(other_user)
    db_session.commit()

    def _get_db():
        try:
            yield db_session
        finally:
            pass

    def _get_current_user():
        return other_user

    fastapi_app.dependency_overrides[get_db] = _get_db
    fastapi_app.dependency_overrides[get_current_user] = _get_current_user
    try:
        yield TestClient(fastapi_app)
    finally:
        fastapi_app.dependency_overrides.clear()


# ─── Helpers ──────────────────────────────────────────────────────

CORRECTED = {
    "damage_type": "spalling",
    "severity": "S3",
    "bbox": {"x1": 15.0, "y1": 25.0, "x2": 130.0, "y2": 140.0},
    "confidence_score": 1.0,
}

ADDED = {
    "damage_type": "delamination",
    "severity": "S1",
    "bbox": {"x1": 200.0, "y1": 200.0, "x2": 250.0, "y2": 260.0},
    "confidence_score": 0.5,  # must be forced to 1.0 server-side
}


def _start(client, insp_id):
    return client.post(f"/api/v1/inspections/{insp_id}/start-review")


def _submit(client, image_id, reviews):
    return client.post(f"/api/v1/images/{image_id}/submit-review", json={"reviews": reviews})


def _submit_all(client, d):
    """Review all 4 detections: accept A, reject B, modify C, accept D, add 1 on img2."""
    r1 = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
        {"cv_detection_id": d["det_b"], "action": "rejected", "notes": "false positive"},
        {"cv_detection_id": d["det_c"], "action": "modified",
         "corrected_detection": CORRECTED, "notes": "bbox too tight, severity higher"},
    ])
    r2 = _submit(client, d["img2"], [
        {"cv_detection_id": d["det_d"], "action": "accepted"},
        {"action": "added", "corrected_detection": ADDED, "notes": "missed by CV"},
    ])
    return r1, r2


# ─── start-review ─────────────────────────────────────────────────

def test_start_review_locks_detections_and_sets_status(client, db_session, review_data):
    d = review_data
    resp = _start(client, d["inspection_id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending_review"
    assert body["locked_detections_count"] == 4

    insp = db_session.get(Inspection, d["inspection_id"])
    assert insp.status == "pending_review"
    for det_key in ("det_a", "det_b", "det_c", "det_d"):
        det = db_session.get(Detection, d[det_key])
        db_session.refresh(det)
        assert det.is_locked is True
        assert det.source == "cv_model"


def test_start_review_twice_returns_409(client, review_data):
    d = review_data
    assert _start(client, d["inspection_id"]).status_code == 200
    resp = _start(client, d["inspection_id"])
    assert resp.status_code == 409


def test_start_review_after_complete_returns_409(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review").status_code == 200
    assert _start(client, d["inspection_id"]).status_code == 409


def test_start_review_missing_inspection_404(client):
    assert _start(client, "no-such-inspection").status_code == 404


# ─── submit-review ────────────────────────────────────────────────

def test_submit_review_before_start_review_returns_409(client, review_data):
    d = review_data
    resp = _submit(client, d["img1"], [{"cv_detection_id": d["det_a"], "action": "accepted"}])
    assert resp.status_code == 409


def test_submit_review_counts_and_rows(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    r1, r2 = _submit_all(client, d)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text

    b1 = r1.json()
    assert b1["reviews_written"] == 3
    assert (b1["cv_accepted"], b1["cv_rejected"], b1["cv_modified"], b1["engineer_added"]) == (1, 1, 1, 0)
    b2 = r2.json()
    assert b2["reviews_written"] == 2
    assert (b2["cv_accepted"], b2["cv_rejected"], b2["cv_modified"], b2["engineer_added"]) == (1, 0, 0, 1)

    rows = db_session.query(DetectionReview).filter(
        DetectionReview.inspection_id == d["inspection_id"]).all()
    assert len(rows) == 5
    by_action = {a: [r for r in rows if r.action == a]
                 for a in ("accepted", "rejected", "modified", "added")}
    assert len(by_action["accepted"]) == 2
    assert len(by_action["rejected"]) == 1
    assert len(by_action["modified"]) == 1
    assert len(by_action["added"]) == 1
    # rejected/accepted rows have no engineer detection
    for r in by_action["accepted"] + by_action["rejected"]:
        assert r.engineer_detection_id is None
    # added row has no cv detection
    assert by_action["added"][0].cv_detection_id is None
    assert by_action["added"][0].engineer_detection_id is not None


def test_rejected_creates_no_new_detection(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    before = db_session.query(Detection).count()
    resp = _submit(client, d["img1"], [{"cv_detection_id": d["det_b"], "action": "rejected"}])
    assert resp.status_code == 200
    assert db_session.query(Detection).count() == before


def test_modified_creates_engineer_detection_with_server_delta(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": CORRECTED},
    ])
    assert resp.status_code == 200, resp.text

    row = db_session.query(DetectionReview).filter(
        DetectionReview.cv_detection_id == d["det_c"]).one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.source == "engineer_added"
    assert new_det.model_name == "engineer_review"
    assert new_det.confidence_score == 1.0
    assert new_det.damage_type == "spalling"
    assert new_det.severity == "S3"
    assert (new_det.bbox_x1, new_det.bbox_y1, new_det.bbox_x2, new_det.bbox_y2) == (15.0, 25.0, 130.0, 140.0)

    delta = row.delta_json
    assert delta["bbox_changed"] is True
    assert delta["bbox_before"] == {"x1": 10.0, "y1": 20.0, "x2": 110.0, "y2": 120.0}
    assert delta["bbox_after"] == {"x1": 15.0, "y1": 25.0, "x2": 130.0, "y2": 140.0}
    assert delta["severity_changed"] is True
    assert delta["severity_before"] == "S2"
    assert delta["severity_after"] == "S3"
    assert delta["damage_type_changed"] is True
    assert delta["damage_type_before"] == "corrosion"
    assert delta["damage_type_after"] == "spalling"


def test_locked_cv_detection_content_unchanged_after_modify(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": CORRECTED},
    ])
    original = db_session.get(Detection, d["det_c"])
    db_session.refresh(original)
    # Content fields untouched
    assert original.damage_type == "corrosion"
    assert original.severity == "S2"
    assert (original.bbox_x1, original.bbox_y1, original.bbox_x2, original.bbox_y2) == (10.0, 20.0, 110.0, 120.0)
    assert original.confidence_score == 0.8
    assert original.is_locked is True
    assert original.source == "cv_model"
    # Review flags set
    assert original.reviewed is True
    assert original.reviewed_by == "test@example.com"
    assert original.review_date is not None


def test_engineer_added_confidence_forced_to_one(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img2"], [
        {"action": "added", "corrected_detection": ADDED},  # client sends 0.5
    ])
    assert resp.status_code == 200, resp.text
    row = db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img2"], DetectionReview.action == "added").one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.confidence_score == 1.0
    assert new_det.confidence == 1.0
    assert new_det.source == "engineer_added"
    assert new_det.reviewed is True


def test_duplicate_cv_detection_resubmission_returns_409(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    assert _submit(client, d["img1"], [{"cv_detection_id": d["det_a"], "action": "accepted"}]).status_code == 200
    resp = _submit(client, d["img1"], [{"cv_detection_id": d["det_a"], "action": "rejected"}])
    assert resp.status_code == 409


def test_submit_review_detection_from_other_image_rejected(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    # det_d belongs to img2, submitted against img1
    resp = _submit(client, d["img1"], [{"cv_detection_id": d["det_d"], "action": "accepted"}])
    assert resp.status_code == 400


# ─── validation (422) ─────────────────────────────────────────────

def test_modified_without_corrected_detection_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [{"cv_detection_id": d["det_a"], "action": "modified"}])
    assert resp.status_code == 422


def test_added_with_cv_detection_id_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "added", "corrected_detection": ADDED},
    ])
    assert resp.status_code == 422


def test_accepted_without_cv_detection_id_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [{"action": "accepted"}])
    assert resp.status_code == 422


def test_invalid_severity_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    bad = dict(CORRECTED, severity="S5")
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": bad},
    ])
    assert resp.status_code == 422


def test_invalid_action_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [{"cv_detection_id": d["det_a"], "action": "approved"}])
    assert resp.status_code == 422


# ─── complete-review ──────────────────────────────────────────────

def test_complete_review_requires_pending_review_status(client, review_data):
    d = review_data
    resp = client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")
    assert resp.status_code == 409


def test_complete_review_with_unreviewed_detections_409(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    # Review only image1 — det_d on image2 stays unreviewed
    _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
        {"cv_detection_id": d["det_b"], "action": "rejected"},
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": CORRECTED},
    ])
    resp = client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")
    assert resp.status_code == 409
    assert "1 CV detection" in resp.json()["detail"]


def test_complete_review_summary_math(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    resp = client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "review_completed"
    s = body["summary"]
    assert s["total_cv_detections"] == 4
    assert s["accepted"] == 2
    assert s["rejected"] == 1
    assert s["modified"] == 1
    assert s["engineer_added"] == 1
    assert s["final_verified_count"] == 4   # 2 accepted + 1 modified + 1 added
    assert s["cv_accuracy_pct"] == 75.0     # (2 + 1) / 4 * 100

    insp = db_session.get(Inspection, d["inspection_id"])
    db_session.refresh(insp)
    assert insp.status == "review_completed"


def test_complete_review_twice_returns_409(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review").status_code == 200
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review").status_code == 409


# ─── review-diff ──────────────────────────────────────────────────

def test_review_diff_full(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")

    resp = client.get(f"/api/v1/inspections/{d['inspection_id']}/review-diff")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # totals
    t = body["totals"]
    assert t["cv_detections"] == 4
    assert t["accepted"] == 2
    assert t["rejected"] == 1
    assert t["modified"] == 1
    assert t["engineer_added"] == 1
    assert t["final_count"] == 4
    assert t["accuracy_pct"] == 75.0
    assert body["reviewed_by"] == "test@example.com"

    # per-image
    per_image = {p["image_id"]: p for p in body["per_image"]}
    assert set(per_image) == {d["img1"], d["img2"]}
    p1 = per_image[d["img1"]]
    assert p1["filename"] == "img1.jpg"
    assert p1["cv_count"] == 3
    assert p1["final_count"] == 2            # 1 accepted + 1 modified
    assert p1["accuracy_pct"] == 66.7        # 2/3
    assert len(p1["actions"]) == 3
    p2 = per_image[d["img2"]]
    assert p2["filename"] == "img2.jpg"
    assert p2["cv_count"] == 1
    assert p2["final_count"] == 2            # 1 accepted + 1 added
    assert p2["accuracy_pct"] == 100.0
    actions2 = {a["action"] for a in p2["actions"]}
    assert actions2 == {"accepted", "added"}

    # damage_type accuracy keyed by ORIGINAL CV damage type
    dta = body["damage_type_accuracy"]
    assert set(dta) == {"corrosion", "crack"}
    assert dta["corrosion"] == {"cv": 2, "accepted": 1, "rejected": 0, "modified": 1, "pct": 100.0}
    assert dta["crack"] == {"cv": 2, "accepted": 1, "rejected": 1, "modified": 0, "pct": 50.0}
    # modified detection re-typed to 'spalling' must NOT appear as a key
    assert "spalling" not in dta

    # modification log
    mods = body["modifications"]
    assert len(mods) == 1
    m = mods[0]
    assert m["cv_detection_id"] == d["det_c"]
    assert m["image_filename"] == "img1.jpg"
    delta = m["delta"]
    assert delta["bbox_changed"] is True
    assert delta["bbox_before"] == {"x1": 10.0, "y1": 20.0, "x2": 110.0, "y2": 120.0}
    assert delta["bbox_after"] == {"x1": 15.0, "y1": 25.0, "x2": 130.0, "y2": 140.0}
    assert delta["severity_changed"] is True
    assert delta["severity_before"] == "S2"
    assert delta["severity_after"] == "S3"


def test_review_diff_before_any_review_is_empty(client, review_data):
    d = review_data
    resp = client.get(f"/api/v1/inspections/{d['inspection_id']}/review-diff")
    assert resp.status_code == 200
    body = resp.json()
    assert body["totals"]["cv_detections"] == 0   # nothing locked yet
    assert body["per_image"] == []
    assert body["modifications"] == []


# ─── review-stats ─────────────────────────────────────────────────

def test_review_stats_happy_path_math(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)

    # Inspection still pending_review — not counted yet
    resp = client.get("/api/v1/review-stats")
    assert resp.status_code == 200, resp.text
    assert resp.json()["overall"]["reviewed_inspections"] == 0

    client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")

    resp = client.get("/api/v1/review-stats")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    o = body["overall"]
    assert o["reviewed_inspections"] == 1
    assert o["total_cv_detections"] == 4
    assert o["accepted"] == 2
    assert o["rejected"] == 1
    assert o["modified"] == 1
    assert o["engineer_added"] == 1
    assert o["avg_accuracy_pct"] == 75.0    # (2 + 1) / 4 * 100, pooled

    dta = body["by_damage_type"]
    assert set(dta) == {"corrosion", "crack"}
    assert dta["corrosion"] == {"cv": 2, "accepted": 1, "rejected": 0, "modified": 1, "pct": 100.0}
    assert dta["crack"] == {"cv": 2, "accepted": 1, "rejected": 1, "modified": 0, "pct": 50.0}
    # modified detection re-typed to 'spalling' must NOT appear as a key
    assert "spalling" not in dta

    recent = body["recent"]
    assert len(recent) == 1
    r = recent[0]
    assert r["inspection_id"] == d["inspection_id"]
    assert r["name"] == "Review Test Inspection"
    assert r["reviewed_at"] is not None
    assert r["accuracy_pct"] == 75.0
    assert r["cv_detections"] == 4


def test_review_stats_empty_org_returns_zeros(client):
    resp = client.get("/api/v1/review-stats")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["overall"] == {
        "reviewed_inspections": 0,
        "total_cv_detections": 0,
        "accepted": 0,
        "rejected": 0,
        "modified": 0,
        "engineer_added": 0,
        "avg_accuracy_pct": 0.0,
    }
    assert body["by_damage_type"] == {}
    assert body["recent"] == []


def test_review_stats_org_isolation(db_session, other_org_client, review_data, test_org):
    # Seed a completed review in test-org directly (other_org_client and
    # client cannot coexist — both override get_current_user on the app)
    d = review_data
    insp = db_session.get(Inspection, d["inspection_id"])
    insp.status = "review_completed"
    det = db_session.get(Detection, d["det_a"])
    det.is_locked = True
    det.source = "cv_model"
    db_session.add(DetectionReview(
        organization_id=test_org.organization_id,
        image_id=d["img1"],
        inspection_id=d["inspection_id"],
        cv_detection_id=d["det_a"],
        action="accepted",
        reviewed_by="test@example.com",
    ))
    db_session.commit()

    # The other org sees nothing
    resp = other_org_client.get("/api/v1/review-stats")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["overall"]["reviewed_inspections"] == 0
    assert body["overall"]["total_cv_detections"] == 0
    assert body["by_damage_type"] == {}
    assert body["recent"] == []


# ─── annotation labels (segments / damage codes / shape / defect_id) ──

LABELED_CORRECTED = {
    **CORRECTED,
    "damage_code": "SP",
    "structural_segments": ["DT", "PS"],
    "defect_id": "pier-1",     # lowercase — must be coerced to PIER-1
    "shape_type": "ellipse",
}

LABELED_ADDED = {
    **ADDED,
    "damage_code": "DL",
    "structural_segments": ["BH"],
    "defect_id": "BH-002",
    "shape_type": "ellipse",
}


def test_modified_with_annotation_labels(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": LABELED_CORRECTED},
    ])
    assert resp.status_code == 200, resp.text

    row = db_session.query(DetectionReview).filter(
        DetectionReview.cv_detection_id == d["det_c"]).one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.shape_type == "ellipse"
    meta = new_det.domain_metadata
    assert meta["code"] == "SP"
    assert meta["segments"] == ["DT", "PS"]
    assert meta["segment"] == "DT, PS"
    assert meta["defect_id"] == "PIER-1"    # uppercase coercion

    delta = row.delta_json
    # original CV detection has no domain_metadata → segments [] vs ["DT","PS"]
    assert delta["segments_changed"] is True
    assert delta["segments_before"] == []
    assert delta["segments_after"] == ["DT", "PS"]
    # original shape_type defaults to rect → ellipse
    assert delta["shape_changed"] is True
    assert delta["shape_before"] == "rect"
    assert delta["shape_after"] == "ellipse"


def test_modified_same_segments_and_shape_not_flagged(client, db_session, review_data):
    d = review_data
    # Give the original CV detection matching labels (order differs deliberately)
    original = db_session.get(Detection, d["det_c"])
    original.shape_type = "ellipse"
    original.domain_metadata = {"code": "CO", "segments": ["PS", "DT"], "segment": "PS, DT"}
    db_session.commit()

    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": LABELED_CORRECTED},
    ])
    assert resp.status_code == 200, resp.text

    row = db_session.query(DetectionReview).filter(
        DetectionReview.cv_detection_id == d["det_c"]).one()
    delta = row.delta_json
    assert delta["segments_changed"] is False    # order-insensitive
    assert "segments_before" not in delta
    assert delta["shape_changed"] is False
    assert "shape_before" not in delta


def test_added_with_annotation_labels(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img2"], [
        {"action": "added", "corrected_detection": LABELED_ADDED},
    ])
    assert resp.status_code == 200, resp.text
    row = db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img2"], DetectionReview.action == "added").one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.shape_type == "ellipse"
    assert new_det.domain_metadata == {
        "code": "DL", "segments": ["BH"], "segment": "BH", "defect_id": "BH-002",
    }


def test_labels_optional_defaults(client, db_session, review_data):
    # Existing payload shape with no label fields must still work
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img2"], [
        {"action": "added", "corrected_detection": ADDED},
    ])
    assert resp.status_code == 200, resp.text
    row = db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img2"], DetectionReview.action == "added").one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.shape_type == "rect"
    # fallback code = first 2 letters of damage_type, uppercase
    assert new_det.domain_metadata["code"] == "DE"   # delamination
    assert new_det.domain_metadata["segments"] == []
    assert "segment" not in new_det.domain_metadata
    assert "defect_id" not in new_det.domain_metadata


def test_invalid_segment_code_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    bad = dict(LABELED_CORRECTED, structural_segments=["DT", "XX"])
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": bad},
    ])
    assert resp.status_code == 422


def test_invalid_damage_code_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    bad = dict(LABELED_CORRECTED, damage_code="ZZ")
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": bad},
    ])
    assert resp.status_code == 422


def test_invalid_shape_type_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    bad = dict(LABELED_CORRECTED, shape_type="polygon")
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": bad},
    ])
    assert resp.status_code == 422


def test_invalid_defect_id_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    # 'bad id!' stays invalid even after uppercase coercion (space and '!')
    bad = dict(LABELED_CORRECTED, defect_id="bad id!")
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": bad},
    ])
    assert resp.status_code == 422


def test_defect_id_too_long_422(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    bad = dict(LABELED_CORRECTED, defect_id="A" * 51)
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": bad},
    ])
    assert resp.status_code == 422


# ─── PATCH asset-type ─────────────────────────────────────────────

def test_patch_asset_type_happy_path(client, db_session, review_data):
    d = review_data
    resp = client.patch(f"/api/v1/images/{d['img1']}/asset-type", json={"asset_type": "pier"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"image_id": d["img1"], "asset_type": "pier"}

    img = db_session.get(Image, d["img1"])
    db_session.refresh(img)
    assert img.domain_metadata["asset_type"] == "pier"


def test_patch_asset_type_preserves_existing_metadata(client, db_session, review_data):
    d = review_data
    img = db_session.get(Image, d["img1"])
    img.domain_metadata = {"existing_key": "keep-me"}
    db_session.commit()

    resp = client.patch(f"/api/v1/images/{d['img1']}/asset-type", json={"asset_type": "seawall"})
    assert resp.status_code == 200, resp.text
    db_session.refresh(img)
    assert img.domain_metadata == {"existing_key": "keep-me", "asset_type": "seawall"}


def test_patch_asset_type_invalid_value_422(client, review_data):
    d = review_data
    resp = client.patch(f"/api/v1/images/{d['img1']}/asset-type", json={"asset_type": "spaceship"})
    assert resp.status_code == 422


def test_patch_asset_type_other_org_404(other_org_client, review_data):
    d = review_data
    resp = other_org_client.patch(f"/api/v1/images/{d['img1']}/asset-type", json={"asset_type": "pier"})
    assert resp.status_code == 404


# ─── org isolation ────────────────────────────────────────────────

def test_other_org_user_gets_404_on_all_endpoints(other_org_client, review_data):
    d = review_data
    insp = d["inspection_id"]
    assert other_org_client.post(f"/api/v1/inspections/{insp}/start-review").status_code == 404
    assert other_org_client.post(
        f"/api/v1/images/{d['img1']}/submit-review",
        json={"reviews": [{"cv_detection_id": d["det_a"], "action": "accepted"}]},
    ).status_code == 404
    assert other_org_client.post(f"/api/v1/inspections/{insp}/complete-review").status_code == 404
    assert other_org_client.get(f"/api/v1/inspections/{insp}/review-diff").status_code == 404
