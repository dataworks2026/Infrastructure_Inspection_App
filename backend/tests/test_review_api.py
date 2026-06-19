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


# ─── review-export.json (training-data export) ───────────────────

def _export(client, insp_id):
    return client.get(f"/api/v1/inspections/{insp_id}/review-export.json")


def _submit_all_labeled(client, d):
    """Same flow as _submit_all but with annotation labels on modified/added."""
    r1 = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
        {"cv_detection_id": d["det_b"], "action": "rejected", "notes": "false positive"},
        {"cv_detection_id": d["det_c"], "action": "modified",
         "corrected_detection": LABELED_CORRECTED, "notes": "bbox too tight"},
    ])
    r2 = _submit(client, d["img2"], [
        {"cv_detection_id": d["det_d"], "action": "accepted"},
        {"action": "added", "corrected_detection": LABELED_ADDED, "notes": "missed by CV"},
    ])
    return r1, r2


def test_review_export_full_flow(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    r1, r2 = _submit_all_labeled(client, d)
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review").status_code == 200

    resp = _export(client, d["inspection_id"])
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/json")
    dispo = resp.headers["content-disposition"]
    assert "attachment" in dispo
    assert "Review_Test_Inspection_review_export.json" in dispo

    body = resp.json()

    # ── envelope ──
    assert body["inspection_id"] == d["inspection_id"]
    assert body["export_version"] == "1.1"
    assert body["export_variant"] == "engineer_review"
    assert body["source_app"] == "inspection_app"
    assert body["asset_name"] == "Pier 9"
    assert body["generated_at"] is not None

    # ── review block ──
    rev = body["review"]
    assert rev["status"] == "review_completed"
    assert rev["reviewed_by"] == "test@example.com"
    assert rev["reviewed_at"] is not None
    assert rev["totals"] == {
        "cv_detections": 4, "accepted": 2, "rejected": 1, "modified": 1,
        "engineer_added": 1, "final_count": 4, "accuracy_pct": 75.0,
    }

    # ── image-level counts ──
    assert body["total_images"] == 2
    assert body["total_annotations"] == 4
    images = {i["image_id"]: i for i in body["images"]}
    assert set(images) == {d["img1"], d["img2"]}
    for img in body["images"]:
        assert img["annotation_status"] == "completed"
        assert img["num_annotations"] == len(img["annotations"])
    assert sum(i["num_annotations"] for i in body["images"]) == body["total_annotations"]

    # ── image 1: accepted + modified in annotations, rejected absent ──
    i1 = images[d["img1"]]
    assert i1["filename"] == "img1.jpg"
    assert i1["num_annotations"] == 2
    anns1 = {a["origin"]: a for a in i1["annotations"]}
    assert set(anns1) == {"cv_accepted", "engineer_modified"}

    # accepted — fields come from the ORIGINAL CV detection (v1.1 shape)
    acc = anns1["cv_accepted"]
    assert acc["annotation_id"] == d["det_a"]
    assert acc["cv_detection_id"] == d["det_a"]
    assert acc["bbox"] == {"x": 10.0, "y": 20.0, "width": 100.0, "height": 100.0}
    assert acc["shape_type"] == "rect"
    assert acc["damage_type"] == {"code": "CO", "label": "Corrosion"}
    assert acc["severity"] == {"level": 2, "label": "Moderate"}
    assert acc["structural_segments"] == []
    assert acc["defect_id"] is None

    # modified — fields come from the engineer's CORRECTED detection
    mod = anns1["engineer_modified"]
    assert mod["cv_detection_id"] == d["det_c"]
    assert mod["annotation_id"] != d["det_c"]
    assert mod["bbox"] == {"x": 15.0, "y": 25.0, "width": 115.0, "height": 115.0}
    assert mod["shape_type"] == "ellipse"
    assert mod["damage_type"] == {"code": "SP", "label": "Spalling"}
    assert mod["severity"] == {"level": 3, "label": "Advanced"}
    assert mod["structural_segments"] == [{"code": "DT"}, {"code": "PS"}]
    assert mod["defect_id"] == "PIER-1"

    # rejected det_b absent from annotations
    assert d["det_b"] not in {a["annotation_id"] for a in i1["annotations"]}

    # cv_predictions — ALL 3 locked CV detections on img1, lossless
    preds1 = {p["detection_id"]: p for p in i1["cv_predictions"]}
    assert set(preds1) == {d["det_a"], d["det_b"], d["det_c"]}
    pa = preds1[d["det_a"]]
    assert pa["bbox"] == {"x": 10.0, "y": 20.0, "width": 100.0, "height": 100.0}
    assert pa["confidence"] == 0.8
    assert pa["model_name"] == "yolov8-maritime"
    assert pa["review"]["action"] == "accepted"
    assert pa["review"]["engineer_annotation_id"] is None
    assert pa["review"]["delta"] is None
    pb = preds1[d["det_b"]]
    assert pb["review"]["action"] == "rejected"
    assert pb["review"]["engineer_annotation_id"] is None
    assert pb["review"]["delta"] is None
    assert pb["review"]["notes"] == "false positive"
    assert pb["review"]["reviewed_by"] == "test@example.com"
    # modified prediction links to the corrected annotation, delta verbatim
    pc = preds1[d["det_c"]]
    assert pc["damage_type"] == {"code": "CO", "label": "Corrosion"}   # frozen original
    assert pc["review"]["action"] == "modified"
    assert pc["review"]["engineer_annotation_id"] == mod["annotation_id"]
    db_row = db_session.query(DetectionReview).filter(
        DetectionReview.cv_detection_id == d["det_c"]).one()
    assert pc["review"]["delta"] == db_row.delta_json

    # ── image 2: accepted + added in annotations, added absent from preds ──
    i2 = images[d["img2"]]
    assert i2["num_annotations"] == 2
    anns2 = {a["origin"]: a for a in i2["annotations"]}
    assert set(anns2) == {"cv_accepted", "engineer_added"}
    add = anns2["engineer_added"]
    assert add["cv_detection_id"] is None
    assert add["bbox"] == {"x": 200.0, "y": 200.0, "width": 50.0, "height": 60.0}
    assert add["shape_type"] == "ellipse"
    assert add["damage_type"] == {"code": "DL", "label": "Delamination"}
    assert add["severity"] == {"level": 1, "label": "Minor"}
    assert add["structural_segments"] == [{"code": "BH"}]
    assert add["defect_id"] == "BH-002"
    # engineer-added detection never appears in cv_predictions
    assert [p["detection_id"] for p in i2["cv_predictions"]] == [d["det_d"]]
    assert i2["cv_predictions"][0]["review"]["action"] == "accepted"


def test_review_export_partial_pending_review(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    # Review only image1 — det_d on image2 stays unreviewed
    _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
        {"cv_detection_id": d["det_b"], "action": "rejected"},
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": CORRECTED},
    ])
    resp = _export(client, d["inspection_id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["review"]["status"] == "pending_review"
    # only the reviewed image is exported
    assert body["total_images"] == 1
    assert body["images"][0]["image_id"] == d["img1"]
    # unreviewed CV detections on the exported image would carry review: null
    for p in body["images"][0]["cv_predictions"]:
        assert p["review"] is not None   # all 3 on img1 were reviewed


def test_review_export_409_before_any_review(client, review_data):
    d = review_data
    # status 'completed' — review never started
    assert _export(client, d["inspection_id"]).status_code == 409
    # review started but no image submitted yet — still 409
    _start(client, d["inspection_id"])
    assert _export(client, d["inspection_id"]).status_code == 409


def test_review_export_missing_inspection_404(client):
    assert _export(client, "no-such-inspection").status_code == 404


def test_review_export_other_org_404(other_org_client, review_data):
    d = review_data
    assert _export(other_org_client, d["inspection_id"]).status_code == 404


# ─── review_action on detection payloads (analysis router) ───────

def test_detections_review_action_null_before_review(client, review_data):
    d = review_data
    resp = client.get(f"/api/v1/inspections/{d['inspection_id']}/all-detections")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    all_dets = [det for img in body.values() for det in img["detections"]]
    assert len(all_dets) == 4
    for det in all_dets:
        assert "review_action" in det
        assert det["review_action"] is None

    # per-image endpoint too
    resp = client.get(f"/api/v1/images/{d['img1']}/detections")
    assert resp.status_code == 200, resp.text
    for det in resp.json()["detections"]:
        assert det["review_action"] is None


def test_detections_review_action_after_full_review(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")

    resp = client.get(f"/api/v1/inspections/{d['inspection_id']}/all-detections")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_id = {det["id"]: det for img in body.values() for det in img["detections"]}

    # CV detections carry the engineer's verdict
    assert by_id[d["det_a"]]["review_action"] == "accepted"
    assert by_id[d["det_b"]]["review_action"] == "rejected"
    assert by_id[d["det_c"]]["review_action"] == "modified"
    assert by_id[d["det_d"]]["review_action"] == "accepted"

    # Engineer detections carry their provenance ('modified' / 'added')
    eng = [det for det in by_id.values() if det["source"] == "engineer_added"]
    assert len(eng) == 2
    actions = sorted(det["review_action"] for det in eng)
    assert actions == ["added", "modified"]
    # the 'modified' engineer det lives on img1, 'added' on img2
    img1_eng = [det for det in body[d["img1"]]["detections"] if det["source"] == "engineer_added"]
    img2_eng = [det for det in body[d["img2"]]["detections"] if det["source"] == "engineer_added"]
    assert [det["review_action"] for det in img1_eng] == ["modified"]
    assert [det["review_action"] for det in img2_eng] == ["added"]

    # existing keys unchanged
    sample = by_id[d["det_a"]]
    for key in ("id", "damage_type", "confidence", "bbox", "severity",
                "source", "is_locked", "reviewed", "reviewed_by",
                "shape_type", "domain_metadata"):
        assert key in sample


def test_image_detections_review_action_after_review(client, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)

    resp = client.get(f"/api/v1/images/{d['img1']}/detections")
    assert resp.status_code == 200, resp.text
    by_id = {det["id"]: det for det in resp.json()["detections"]}
    assert by_id[d["det_a"]]["review_action"] == "accepted"
    assert by_id[d["det_b"]]["review_action"] == "rejected"
    assert by_id[d["det_c"]]["review_action"] == "modified"
    eng = [det for det in by_id.values() if det["source"] == "engineer_added"]
    assert [det["review_action"] for det in eng] == ["modified"]


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


# ─── damage_type casing normalization ─────────────────────────────

def test_modified_damage_type_normalized_to_title_case(client, db_session, review_data):
    """A modify with damage_code 'CO' stores Detection.damage_type 'Corrosion'
    (Title case), matching the CV/YOLO convention."""
    d = review_data
    _start(client, d["inspection_id"])
    corrected = {**CORRECTED, "damage_type": "corrosion", "damage_code": "CO"}
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": corrected},
    ])
    assert resp.status_code == 200, resp.text
    row = db_session.query(DetectionReview).filter(
        DetectionReview.cv_detection_id == d["det_c"]).one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.damage_type == "Corrosion"


def test_added_damage_type_normalized_to_title_case(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    added = {**ADDED, "damage_type": "delamination", "damage_code": "DL"}
    resp = _submit(client, d["img2"], [
        {"action": "added", "corrected_detection": added},
    ])
    assert resp.status_code == 200, resp.text
    row = db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img2"], DetectionReview.action == "added").one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.damage_type == "Delamination"


def test_modified_damage_type_falls_back_when_no_code(client, db_session, review_data):
    """No damage_code → fall back to the raw submitted damage_type."""
    d = review_data
    _start(client, d["inspection_id"])
    corrected = {**CORRECTED, "damage_type": "spalling"}  # no damage_code
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_c"], "action": "modified", "corrected_detection": corrected},
    ])
    assert resp.status_code == 200, resp.text
    row = db_session.query(DetectionReview).filter(
        DetectionReview.cv_detection_id == d["det_c"]).one()
    new_det = db_session.get(Detection, row.engineer_detection_id)
    assert new_det.damage_type == "spalling"


# ─── reopen-review (per-image + whole-inspection) ─────────────────

def test_reopen_image_review_after_completion(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review").status_code == 200

    resp = client.post(f"/api/v1/images/{d['img1']}/reopen-review")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["image_id"] == d["img1"]
    assert body["inspection_id"] == d["inspection_id"]
    assert body["status"] == "pending_review"
    # img1: 3 reviews (accept/reject/modify), 1 engineer detection (modified), 3 CV reset
    assert body["cleared_reviews"] == 3
    assert body["removed_engineer_detections"] == 1
    assert body["reset_cv_detections"] == 3

    # img1 reviews gone; img2 reviews intact
    assert db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img1"]).count() == 0
    assert db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img2"]).count() == 2

    # img1 engineer detections gone; img2 engineer detection intact
    assert db_session.query(Detection).filter(
        Detection.image_id == d["img1"], Detection.source == "engineer_added").count() == 0
    assert db_session.query(Detection).filter(
        Detection.image_id == d["img2"], Detection.source == "engineer_added").count() == 1

    # img1 CV detections unreviewed again, still locked
    for det_key in ("det_a", "det_b", "det_c"):
        det = db_session.get(Detection, d[det_key])
        db_session.refresh(det)
        assert det.reviewed is False
        assert det.reviewed_by is None
        assert det.review_date is None
        assert det.is_locked is True
        assert det.source == "cv_model"

    # det_d (img2) still reviewed
    det_d = db_session.get(Detection, d["det_d"])
    db_session.refresh(det_d)
    assert det_d.reviewed is True

    insp = db_session.get(Inspection, d["inspection_id"])
    db_session.refresh(insp)
    assert insp.status == "pending_review"


def test_reopen_inspection_review_after_completion(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review").status_code == 200

    resp = client.post(f"/api/v1/inspections/{d['inspection_id']}/reopen-review")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending_review"
    assert body["cleared_reviews"] == 5     # 3 on img1 + 2 on img2
    assert body["removed_engineer_detections"] == 2  # 1 modified + 1 added
    assert body["reset_cv_detections"] == 4  # all 4 CV detections

    assert db_session.query(DetectionReview).filter(
        DetectionReview.inspection_id == d["inspection_id"]).count() == 0
    assert db_session.query(Detection).filter(
        Detection.source == "engineer_added").count() == 0
    for det_key in ("det_a", "det_b", "det_c", "det_d"):
        det = db_session.get(Detection, d[det_key])
        db_session.refresh(det)
        assert det.reviewed is False
        assert det.is_locked is True

    insp = db_session.get(Inspection, d["inspection_id"])
    db_session.refresh(insp)
    assert insp.status == "pending_review"


def test_reopen_then_resubmit_succeeds(client, db_session, review_data):
    """After reopen the old 409 'already submitted' must NOT fire — a fresh
    submit-review on the reopened image succeeds."""
    d = review_data
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")

    assert client.post(f"/api/v1/images/{d['img1']}/reopen-review").status_code == 200

    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
        {"cv_detection_id": d["det_b"], "action": "accepted"},
        {"cv_detection_id": d["det_c"], "action": "rejected"},
    ])
    assert resp.status_code == 200, resp.text
    assert db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img1"]).count() == 3


def test_reopen_inspection_merely_completed_409(client, review_data):
    """An inspection that was never reviewed (status 'completed') cannot be reopened."""
    d = review_data
    resp = client.post(f"/api/v1/inspections/{d['inspection_id']}/reopen-review")
    assert resp.status_code == 409


def test_reopen_image_merely_completed_409(client, review_data):
    d = review_data
    resp = client.post(f"/api/v1/images/{d['img1']}/reopen-review")
    assert resp.status_code == 409


def test_reopen_image_pending_review_stays_pending(client, db_session, review_data):
    """Reopening during an in-progress review leaves status as pending_review."""
    d = review_data
    _start(client, d["inspection_id"])
    _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
    ])
    resp = client.post(f"/api/v1/images/{d['img1']}/reopen-review")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "pending_review"
    insp = db_session.get(Inspection, d["inspection_id"])
    db_session.refresh(insp)
    assert insp.status == "pending_review"


def test_reopen_org_isolation_404(other_org_client, review_data):
    d = review_data
    assert other_org_client.post(
        f"/api/v1/images/{d['img1']}/reopen-review").status_code == 404
    assert other_org_client.post(
        f"/api/v1/inspections/{d['inspection_id']}/reopen-review").status_code == 404


# ─── _display_name helper (upload filename convention) ─────────────

def test_display_name_helper():
    from app.routers.images import _display_name, _sanitize
    assert _sanitize("Governors Island Pier") == "Governors-Island-Pier"
    assert _sanitize("  --foo!!bar--  ") == "foo-bar"
    assert _sanitize("") == "asset"
    assert _display_name("Governors Island Pier", "2026-06-12", 3, ".JPG") == \
        "Governors-Island-Pier_2026-06-12_03.jpg"
    assert _display_name("", "2026-01-01", 1, ".png") == "asset_2026-01-01_01.png"
    assert _display_name("Pier", "2026-01-01", 100, ".jpg") == "Pier_2026-01-01_100.jpg"


# ─── annotated-images.zip ─────────────────────────────────────────

import io
import zipfile as _zipfile

from PIL import Image as _PILImage

from app.core.config import settings as _settings


def _write_jpeg(path, color=(120, 130, 140), size=(64, 48)):
    import os as _os
    _os.makedirs(_os.path.dirname(path), exist_ok=True)
    _PILImage.new("RGB", size, color).save(path, format="JPEG")


@pytest.fixture
def zip_files(tmp_path, db_session, review_data, monkeypatch):
    """Point STORAGE_BASE_PATH at a tmp dir and give both images a real
    on-disk JPEG at their stored_path."""
    monkeypatch.setattr(_settings, "STORAGE_BASE_PATH", str(tmp_path))
    d = review_data
    for img_id, rel in ((d["img1"], "img1/raw.jpg"), (d["img2"], "img2/raw.jpg")):
        img = db_session.get(Image, img_id)
        img.stored_path = rel
        _write_jpeg(str(tmp_path / rel))
    db_session.commit()
    return d


def _zip_get(client, insp_id):
    return client.get(f"/api/v1/inspections/{insp_id}/annotated-images.zip")


def test_annotated_zip_full_flow(client, zip_files):
    d = zip_files
    # 409 before review is completed (pending_review)
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    assert _zip_get(client, d["inspection_id"]).status_code == 409

    assert client.post(
        f"/api/v1/inspections/{d['inspection_id']}/complete-review"
    ).status_code == 200

    resp = _zip_get(client, d["inspection_id"])
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/zip"
    dispo = resp.headers["content-disposition"]
    assert "attachment" in dispo
    assert "Review_Test_Inspection_annotated_images.zip" in dispo

    zf = _zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()
    # One entry per image present on disk (2). Both images have verified
    # detections (img1: accepted+modified, img2: accepted+added) → annotated.
    assert len(names) == 2
    for n in names:
        assert n.endswith(".jpg")
        data = zf.read(n)
        assert len(data) > 0
        # bytes form a valid image PIL can reopen
        _PILImage.open(io.BytesIO(data)).verify()
    assert all("_annotated.jpg" in n for n in names)


def test_annotated_zip_409_pending_review(client, zip_files):
    d = zip_files
    # status 'completed' — review never started
    assert _zip_get(client, d["inspection_id"]).status_code == 409
    _start(client, d["inspection_id"])
    # pending_review — still 409
    assert _zip_get(client, d["inspection_id"]).status_code == 409


def test_annotated_zip_other_org_404(other_org_client, zip_files):
    d = zip_files
    assert _zip_get(other_org_client, d["inspection_id"]).status_code == 404


def test_annotated_zip_excludes_rejected_detection(client, db_session, zip_files):
    """A rejected CV detection must NOT be in the verified set the zip renders."""
    from app.services.reports.annotated_zip import build_annotated_zip

    d = zip_files
    _start(client, d["inspection_id"])
    _submit_all(client, d)
    client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")

    # Inspect the grouping directly: det_b was rejected on img1.
    reviews = db_session.query(DetectionReview).filter(
        DetectionReview.inspection_id == d["inspection_id"]
    ).all()
    verified_ids = set()
    for r in reviews:
        if r.action == "accepted":
            verified_ids.add(r.cv_detection_id)
        elif r.action in ("modified", "added"):
            verified_ids.add(r.engineer_detection_id)
    assert d["det_b"] not in verified_ids   # rejected excluded
    assert d["det_a"] in verified_ids       # accepted included

    # And the zip still builds with 2 entries.
    zip_bytes, name = build_annotated_zip(db_session, d["inspection_id"])
    assert name == "Review Test Inspection"
    zf = _zipfile.ZipFile(io.BytesIO(zip_bytes))
    assert len(zf.namelist()) == 2


def test_annotated_zip_clean_image_passthrough(client, db_session, tmp_path, review_data, monkeypatch):
    """An image with no verified detections is passed through unchanged."""
    monkeypatch.setattr(_settings, "STORAGE_BASE_PATH", str(tmp_path))
    d = review_data
    # img1 gets a file; img2 deliberately has no detections reviewed as verified.
    for img_id, rel in ((d["img1"], "a/x.jpg"), (d["img2"], "b/y.jpg")):
        img = db_session.get(Image, img_id)
        img.stored_path = rel
        _write_jpeg(str(tmp_path / rel))
    db_session.commit()

    _start(client, d["inspection_id"])
    # Reject everything on img1, reject det_d on img2 → no verified at all.
    _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "rejected"},
        {"cv_detection_id": d["det_b"], "action": "rejected"},
        {"cv_detection_id": d["det_c"], "action": "rejected"},
    ])
    _submit(client, d["img2"], [
        {"cv_detection_id": d["det_d"], "action": "rejected"},
    ])
    client.post(f"/api/v1/inspections/{d['inspection_id']}/complete-review")

    resp = _zip_get(client, d["inspection_id"])
    assert resp.status_code == 200, resp.text
    zf = _zipfile.ZipFile(io.BytesIO(resp.content))
    names = sorted(zf.namelist())
    # No verified detections → originals passed through under the image's
    # original filename (img.filename), NOT re-encoded / not "_annotated".
    assert names == ["img1.jpg", "img2.jpg"]
    for n in names:
        assert "_annotated" not in n
        assert len(zf.read(n)) > 0
