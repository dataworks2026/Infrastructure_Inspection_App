"""Recommendations PDF: issued as a document, archived, snapshotted, audited
(Rev B 8.3, N7 / MAT-9, OUT-4). The pictures themselves are exercised by
the platform's report tests; here the inspection has no image files, so
the builder takes its "picture not available" path, which is the one a
missing file must take without failing the issue.
"""
import hashlib
import os

import pytest

from app.core.config import settings
from app.services.recommendations import authoring, engine, workflow
from app.services.recommendations.audit import list_audit_events
from app.services.recommendations.pdf import NoApprovedRecommendations, issue_recommendations_pdf
from tests.recommendations.conftest import entry_write, make_detection

ACTOR = "engineer@example.com"


def _approve_one(db, org_id, inspection_id):
    authoring.create_entry(db, org_id, entry_write(detection_class="corrosion", severity=4))
    engine.run_resolution(
        db, org_id, inspection_id,
        [make_detection("d-pdf-1", detection_class="corrosion", severity=4, inspection_id=inspection_id),
         make_detection("d-pdf-2", detection_class="corrosion", severity=2, inspection_id=inspection_id)],
        "asset", ACTOR,
    )
    draft = workflow.list_records(db, org_id, status="Draft")[0]
    workflow.disposition_record(db, org_id, draft.id, "approve", ACTOR)
    return draft


def test_issue_archives_snapshots_and_audits(db_session, test_org, rec_vocab, rec_inspections, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    org_id, inspection_id = test_org.organization_id, rec_inspections[0]
    approved = _approve_one(db_session, org_id, inspection_id)

    pdf, snap = issue_recommendations_pdf(db_session, org_id, inspection_id, ACTOR)

    assert pdf[:4] == b"%PDF"
    assert snap.issued_file_hash == hashlib.sha256(pdf).hexdigest()
    assert len(snap.issued_file_hash) == 64
    assert snap.generated_by == ACTOR
    statuses = {r["record_id"]: r["status"] for r in snap.record_snapshot}
    assert statuses[approved.id] == "Approved"
    assert "Needs Recommendation" in statuses.values()  # the S2 finding had no rule and is in the snapshot too
    pinned = next(r for r in snap.record_snapshot if r["record_id"] == approved.id)
    assert pinned["entry_version"] == approved.matched_entry_version

    archived = os.path.join(str(tmp_path), "recommendation_reports", org_id, inspection_id, f"{snap.id}.pdf")
    assert os.path.isfile(archived)
    assert open(archived, "rb").read() == pdf

    events = [e for e in list_audit_events(db_session, org_id) if e.action == "recommendation_report_issued"]
    assert len(events) == 1
    assert events[0].entity_id == snap.id
    assert events[0].detail["issued_file_hash"] == snap.issued_file_hash


def test_regeneration_is_a_new_document_and_never_overwrites(db_session, test_org, rec_vocab, rec_inspections, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    org_id, inspection_id = test_org.organization_id, rec_inspections[0]
    _approve_one(db_session, org_id, inspection_id)

    pdf1, snap1 = issue_recommendations_pdf(db_session, org_id, inspection_id, ACTOR)
    pdf2, snap2 = issue_recommendations_pdf(db_session, org_id, inspection_id, ACTOR)

    assert snap1.id != snap2.id
    folder = os.path.join(str(tmp_path), "recommendation_reports", org_id, inspection_id)
    assert sorted(os.listdir(folder)) == sorted([f"{snap1.id}.pdf", f"{snap2.id}.pdf"])
    assert open(os.path.join(folder, f"{snap1.id}.pdf"), "rb").read() == pdf1
    assert len([e for e in list_audit_events(db_session, org_id) if e.action == "recommendation_report_issued"]) == 2


def test_nothing_approved_means_nothing_issued(db_session, test_org, rec_vocab, rec_inspections, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    org_id, inspection_id = test_org.organization_id, rec_inspections[0]
    authoring.create_entry(db_session, org_id, entry_write(detection_class="corrosion", severity=4))
    engine.run_resolution(
        db_session, org_id, inspection_id,
        [make_detection("d-pdf-3", detection_class="corrosion", severity=4, inspection_id=inspection_id)],
        "asset", ACTOR,
    )  # Draft only, nobody approved it
    with pytest.raises(NoApprovedRecommendations):
        issue_recommendations_pdf(db_session, org_id, inspection_id, ACTOR)
    assert not os.path.exists(os.path.join(str(tmp_path), "recommendation_reports"))
    assert not [e for e in list_audit_events(db_session, org_id) if e.action == "recommendation_report_issued"]


def test_endpoint_returns_the_pdf(client, db_session, test_org, rec_vocab, rec_inspections, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE_BASE_PATH", str(tmp_path))
    org_id, inspection_id = test_org.organization_id, rec_inspections[0]
    _approve_one(db_session, org_id, inspection_id)
    db_session.commit()

    resp = client.get(f"/api/v1/recommendations/inspections/{inspection_id}/pdf")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content[:4] == b"%PDF"
    assert len(resp.headers["x-recommendation-snapshot"]) == 36

    missing = client.get("/api/v1/recommendations/inspections/not-an-inspection/pdf")
    assert missing.status_code == 404
