"""
Tests that the report loader (app/services/reports/db_loader.py)
returns the VERIFIED detection set after an engineer review:

- rejected CV detections excluded
- modified CV detections excluded (their stale originals would
  double-count next to the engineer's corrected duplicates)
- engineer-added / corrected detections included
- unreviewed CV detections (mid-review) still included
- inspections with NO review rows behave exactly as before
"""

from __future__ import annotations

import pytest

from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.services.reports.db_loader import load_inspection_records

# Re-exported so pytest resolves the fixture in this module too.
from tests.test_review_api import (  # noqa: F401
    review_data,
    CORRECTED,
    _start,
    _submit,
    _submit_all,
)


def _record_ids(db_session, inspection_id):
    records, meta = load_inspection_records(db_session, inspection_id)
    return records, meta, {r["detection_id"] for r in records}


def test_never_reviewed_inspection_returns_all_detections(client, db_session, review_data):
    d = review_data
    records, meta, ids = _record_ids(db_session, d["inspection_id"])
    assert ids == {d["det_a"], d["det_b"], d["det_c"], d["det_d"]}
    assert len(records) == 4
    assert meta["inspection_id"] == d["inspection_id"]
    assert db_session.query(DetectionReview).count() == 0  # truly unreviewed


def test_after_full_review_only_verified_set_is_loaded(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    r1, r2 = _submit_all(client, d)
    assert r1.status_code == 200 and r2.status_code == 200
    assert client.post(
        f"/api/v1/inspections/{d['inspection_id']}/complete-review"
    ).status_code == 200

    records, meta, ids = _record_ids(db_session, d["inspection_id"])

    # accepted CV detections kept
    assert d["det_a"] in ids
    assert d["det_d"] in ids
    # rejected CV detection excluded
    assert d["det_b"] not in ids
    # modified CV original excluded
    assert d["det_c"] not in ids

    # engineer duplicates included: 1 modified-replacement + 1 added
    eng_ids = {
        det.id
        for det in db_session.query(Detection).filter(
            Detection.source == "engineer_added"
        )
    }
    assert len(eng_ids) == 2
    assert eng_ids <= ids

    # final verified set: 2 accepted + 1 corrected + 1 added = 4 records
    assert len(records) == 4

    # the corrected detection's record reflects the engineer's values
    by_id = {r["detection_id"]: r for r in records}
    corrected_row = (
        db_session.query(DetectionReview)
        .filter(DetectionReview.cv_detection_id == d["det_c"])
        .one()
    )
    corrected = by_id[corrected_row.engineer_detection_id]
    assert corrected["defect_type"] == "spalling"
    assert corrected["severity"] == "S3"
    assert corrected["risk_level"] == "high"


def test_mid_review_keeps_unreviewed_detections(client, db_session, review_data):
    """Only image1 reviewed; det_d on image2 is still unreviewed and must
    stay in the report. Rejected/modified on image1 already drop out."""
    d = review_data
    _start(client, d["inspection_id"])
    resp = _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "accepted"},
        {"cv_detection_id": d["det_b"], "action": "rejected"},
        {"cv_detection_id": d["det_c"], "action": "modified",
         "corrected_detection": CORRECTED},
    ])
    assert resp.status_code == 200, resp.text

    records, _meta, ids = _record_ids(db_session, d["inspection_id"])
    assert d["det_a"] in ids          # accepted
    assert d["det_d"] in ids          # unreviewed — kept
    assert d["det_b"] not in ids      # rejected
    assert d["det_c"] not in ids      # modified original
    # 2 CV kept + 1 engineer correction
    assert len(records) == 3


def test_all_rejected_raises_no_detections(client, db_session, review_data):
    d = review_data
    _start(client, d["inspection_id"])
    _submit(client, d["img1"], [
        {"cv_detection_id": d["det_a"], "action": "rejected"},
        {"cv_detection_id": d["det_b"], "action": "rejected"},
        {"cv_detection_id": d["det_c"], "action": "rejected"},
    ])
    _submit(client, d["img2"], [
        {"cv_detection_id": d["det_d"], "action": "rejected"},
    ])
    with pytest.raises(ValueError, match="no_detections"):
        load_inspection_records(db_session, d["inspection_id"])
