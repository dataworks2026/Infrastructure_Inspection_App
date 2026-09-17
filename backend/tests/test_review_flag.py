"""Rollback switch for the Engineer Review flow.

Default on, because the flow is live and in use. With REVIEW_FLOW_ENABLED
false every review endpoint answers 404 (the flow does not exist as far as
a client can tell) and /features reports it so the dashboard hides the
entry points. Everything outside the flow is untouched either way.
"""

from app.core.config import settings
from tests import test_review_api

review_data = test_review_api.review_data  # reuse the seeded inspection fixture


def _review_paths(d):
    insp, img = d["inspection_id"], d["img1"]
    return [
        ("post", f"/api/v1/inspections/{insp}/start-review"),
        ("post", f"/api/v1/images/{img}/submit-review"),
        ("post", f"/api/v1/inspections/{insp}/complete-review"),
        ("post", f"/api/v1/images/{img}/reopen-review"),
        ("post", f"/api/v1/inspections/{insp}/reopen-review"),
        ("get", "/api/v1/review-stats"),
        ("get", f"/api/v1/inspections/{insp}/review-diff"),
        ("patch", f"/api/v1/images/{img}/asset-type"),
        ("get", f"/api/v1/inspections/{insp}/review-report.pdf"),
        ("get", f"/api/v1/inspections/{insp}/review-export.json"),
        ("get", f"/api/v1/inspections/{insp}/annotated-images.zip"),
    ]


def test_flag_is_on_by_default(client):
    assert settings.REVIEW_FLOW_ENABLED is True
    assert client.get("/api/v1/features").json() == {"review_flow": True}


def test_features_endpoint_requires_auth(unauthed_client):
    assert unauthed_client.get("/api/v1/features").status_code == 401


def test_review_flow_works_by_default(client, review_data):
    d = review_data
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/start-review").status_code == 200
    assert client.get("/api/v1/review-stats").status_code == 200


def test_flag_off_hides_every_review_endpoint(client, review_data, monkeypatch):
    monkeypatch.setattr(settings, "REVIEW_FLOW_ENABLED", False)
    d = review_data

    assert client.get("/api/v1/features").json() == {"review_flow": False}
    for method, path in _review_paths(d):
        resp = getattr(client, method)(path)
        assert resp.status_code == 404, (method, path, resp.status_code)
        assert resp.json()["detail"] == "Engineer review is not enabled"


def test_flag_off_leaves_the_rest_of_the_api_alone(client, review_data, monkeypatch):
    monkeypatch.setattr(settings, "REVIEW_FLOW_ENABLED", False)
    d = review_data
    assert client.get(f"/api/v1/inspections/{d['inspection_id']}").status_code == 200
    assert client.get("/api/v1/assets").status_code == 200


def test_flag_off_does_not_touch_existing_review_data(client, review_data, monkeypatch):
    # switching the flow off is a rollback of the surface, not of the data:
    # reviews already recorded stay in the database and come back when the
    # flow is switched on again
    d = review_data
    assert client.post(f"/api/v1/inspections/{d['inspection_id']}/start-review").status_code == 200

    monkeypatch.setattr(settings, "REVIEW_FLOW_ENABLED", False)
    assert client.get(f"/api/v1/inspections/{d['inspection_id']}/review-diff").status_code == 404

    monkeypatch.setattr(settings, "REVIEW_FLOW_ENABLED", True)
    body = client.get(f"/api/v1/inspections/{d['inspection_id']}").json()
    assert body["status"] == "pending_review"
    assert client.get(f"/api/v1/inspections/{d['inspection_id']}/review-diff").status_code == 200
