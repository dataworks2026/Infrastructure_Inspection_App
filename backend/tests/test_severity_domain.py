"""Out of domain severity (CTO decision 2026-09-24, issue #16).

The client PDF is an issued document behind the engineer gate, so a
detection whose severity is outside S1 to S4 blocks generation with the
rows named. Internal tools (dashboard, review export) show such rows as
their own unclassified bucket instead of folding them into S1.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.detection import Detection
from app.services.reports.db_loader import SeverityOutOfDomainError, load_inspection_records
from app.services.reports.review_export import _severity_obj
from tests import test_review_api

review_data = test_review_api.review_data


def _set_severity(db_session, detection_id, value):
    """Write a raw severity value straight to the row. Once the S1 to S4
    CHECK constraint exists, a legacy value like S0 can no longer be
    seeded; the tests then cover it through the null case only."""
    det = db_session.get(Detection, detection_id)
    det.severity = value
    try:
        db_session.commit()
    except IntegrityError:
        db_session.rollback()
        pytest.skip(f"severity {value!r} is rejected by the CHECK constraint; legacy value cannot be seeded")


class TestClientPdfFailsLoudly:
    def test_loader_names_every_offending_row(self, db_session, review_data):
        d = review_data
        _set_severity(db_session, d["det_a"], None)
        _set_severity(db_session, d["det_b"], "S0")
        with pytest.raises(SeverityOutOfDomainError) as exc:
            load_inspection_records(db_session, d["inspection_id"])
        offenders = dict(exc.value.offenders)
        assert offenders == {d["det_a"]: None, d["det_b"]: "S0"}

    def test_pdf_endpoint_blocks_with_ids_and_raw_values(self, client, db_session, review_data):
        d = review_data
        _set_severity(db_session, d["det_c"], None)
        resp = client.get(f"/api/v1/reports/inspections/{d['inspection_id']}/pdf")
        assert resp.status_code == 422, resp.text
        detail = resp.json()["detail"]
        assert "outside S1 to S4" in detail["message"]
        assert detail["detections"] == [{"id": d["det_c"], "severity": None}]

    def test_preview_endpoint_blocks_the_same_way(self, client, db_session, review_data):
        d = review_data
        _set_severity(db_session, d["det_d"], None)
        resp = client.get(f"/api/v1/reports/inspections/{d['inspection_id']}/preview")
        assert resp.status_code == 422
        assert resp.json()["detail"]["detections"][0]["id"] == d["det_d"]

    def test_clean_inspection_still_generates(self, client, review_data):
        d = review_data
        resp = client.get(f"/api/v1/reports/inspections/{d['inspection_id']}/preview")
        assert resp.status_code == 200, resp.text


class TestInternalToolsShowTheTruth:
    def test_review_export_marks_legacy_value_unclassified(self):
        assert _severity_obj(Detection(severity="S0")) == {"level": None, "label": "Unclassified", "raw": "S0"}
        assert _severity_obj(Detection(severity="S2")) == {"level": 2, "label": _severity_obj(Detection(severity="S2"))["label"]}
        assert _severity_obj(Detection(severity=None)) is None

    def test_dashboard_defect_summary_has_an_unclassified_bucket(self, client, db_session, review_data):
        d = review_data
        _set_severity(db_session, d["det_a"], "S0")
        resp = client.get("/api/v1/dashboard/defect-summary")
        assert resp.status_code == 200, resp.text
        asset = next(a for a in resp.json()["assets"] if a["asset_id"] == "asset-r1")
        corrosion = next(x for x in asset["damage_types"] if x["damage_type"].lower() == "corrosion")
        assert corrosion["unclassified"] == 1
        assert corrosion["S2"] == 1
        assert corrosion["S1"] == 0, "a legacy S0 is never counted as S1"
        assert asset["totals"]["unclassified"] == 1
