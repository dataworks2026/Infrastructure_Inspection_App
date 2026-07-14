"""
API tests for the single-image delete endpoint (app/routers/images.py).

Endpoint under test:
- DELETE /api/v1/images/{image_id}

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

from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection
from app.models.user import User

from tests.conftest import seed_asset


# ─── Seeding ──────────────────────────────────────────────────────

@pytest.fixture
def delete_data(db_session, test_org):
    """Asset → completed inspection → 2 images with CV detections.

    image A: det_a1 (corrosion), det_a2 (crack)
    image B: det_b1 (crack)
    """
    org_id = test_org.organization_id
    seed_asset(db_session, asset_id="asset-d1", organization_id=org_id, name="Pier 12")

    insp_id = str(uuid.uuid4())
    db_session.add(Inspection(
        id=insp_id,
        organization_id=org_id,
        asset_id="asset-d1",
        inspection_date=date(2026, 6, 1),
        status="completed",
        name="Delete Test Inspection",
        inspector_name="Test Inspector",
    ))

    img_a, img_b = str(uuid.uuid4()), str(uuid.uuid4())
    for img_id, fname in ((img_a, "imgA.jpg"), (img_b, "imgB.jpg")):
        db_session.add(Image(
            id=img_id,
            organization_id=org_id,
            inspection_id=insp_id,
            filename=fname,
            stored_path=f"inspections/{insp_id}/{img_id}.jpg",
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

    det_a1 = _det(img_a, "corrosion")
    det_a2 = _det(img_a, "crack")
    det_b1 = _det(img_b, "crack")
    db_session.commit()

    return {
        "inspection_id": insp_id,
        "img_a": img_a,
        "img_b": img_b,
        "det_a1": det_a1.id,
        "det_a2": det_a2.id,
        "det_b1": det_b1.id,
    }


@pytest.fixture
def other_org_client(db_session, other_org, test_user):
    """TestClient authenticated as a user from a DIFFERENT org."""
    other_user = User(
        id="other-user-del",
        organization_id=other_org.organization_id,
        email="intruder-del@example.com",
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

def _start(client, insp_id):
    return client.post(f"/api/v1/inspections/{insp_id}/start-review")


def _submit(client, image_id, reviews):
    return client.post(f"/api/v1/images/{image_id}/submit-review", json={"reviews": reviews})


# ─── delete happy path ────────────────────────────────────────────

def test_delete_image_cascades_detections_and_reviews(client, db_session, delete_data):
    d = delete_data

    # Give image A some DetectionReview rows via the real review flow.
    assert _start(client, d["inspection_id"]).status_code == 200
    r = _submit(client, d["img_a"], [
        {"cv_detection_id": d["det_a1"], "action": "accepted"},
        {"cv_detection_id": d["det_a2"], "action": "rejected", "notes": "false positive"},
    ])
    assert r.status_code == 200, r.text

    # sanity: review rows exist for image A before delete
    assert db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img_a"]).count() > 0

    resp = client.delete(f"/api/v1/images/{d['img_a']}")
    assert resp.status_code == 204, resp.text
    assert resp.content == b""

    db_session.expire_all()

    # image A + its detections + its reviews are gone
    assert db_session.get(Image, d["img_a"]) is None
    assert db_session.get(Detection, d["det_a1"]) is None
    assert db_session.get(Detection, d["det_a2"]) is None
    assert db_session.query(DetectionReview).filter(
        DetectionReview.image_id == d["img_a"]).count() == 0

    # image B + ITS detection remain intact
    assert db_session.get(Image, d["img_b"]) is not None
    assert db_session.get(Detection, d["det_b1"]) is not None

    # parent inspection still exists
    assert db_session.get(Inspection, d["inspection_id"]) is not None


def test_delete_image_without_reviews(client, db_session, delete_data):
    """An image with only CV detections (no reviews) deletes cleanly."""
    d = delete_data
    resp = client.delete(f"/api/v1/images/{d['img_b']}")
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert db_session.get(Image, d["img_b"]) is None
    assert db_session.get(Detection, d["det_b1"]) is None
    # image A untouched
    assert db_session.get(Image, d["img_a"]) is not None
    assert db_session.get(Detection, d["det_a1"]) is not None


# ─── org isolation + not-found ────────────────────────────────────

def test_delete_image_other_org_404(other_org_client, db_session, delete_data):
    d = delete_data
    resp = other_org_client.delete(f"/api/v1/images/{d['img_a']}")
    assert resp.status_code == 404

    # nothing was deleted
    db_session.expire_all()
    assert db_session.get(Image, d["img_a"]) is not None
    assert db_session.get(Detection, d["det_a1"]) is not None


def test_delete_image_not_found_404(client, delete_data):
    resp = client.delete("/api/v1/images/no-such-image")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Image not found"
