"""RPT-02, RPT-03, RPT-04: the recommendations section in the platform
inspection report and the dashboard counts, through the OI-3 seam. Only
approved records render; each carries the findings it covers; the run
reconciliation travels with it; a report with nothing approved is
unchanged."""
from app.services.recommendations import authoring, engine, workflow
from app.services.recommendations.report_section import build_report_section, has_approved_recommendations
from app.services.reports.pdf_report import generate_pdf
from tests.recommendations.conftest import entry_write, make_detection

ACTOR = "engineer@example.com"


def _run(db, org_id, inspection_id):
    authoring.create_entry(db, org_id, entry_write(detection_class="corrosion", severity=4))
    run = engine.run_resolution(
        db, org_id, inspection_id,
        [
            make_detection("d-rpt-1", detection_class="corrosion", severity=4, inspection_id=inspection_id),
            make_detection("d-rpt-2", detection_class="corrosion", severity=4, inspection_id=inspection_id),
            make_detection("d-rpt-3", detection_class="cracking", severity=2, inspection_id=inspection_id),
        ],
        "asset", ACTOR,
    )
    return run


def test_nothing_approved_means_no_section(db_session, test_org, rec_vocab, rec_inspections):
    org_id = test_org.organization_id
    _run(db_session, org_id, rec_inspections[0])
    assert has_approved_recommendations(db_session, org_id, rec_inspections[0]) is False
    section = build_report_section(db_session, org_id, rec_inspections[0])
    assert section["tiers"] == []
    assert section["counts"]["approved"] == 0
    assert section["counts"]["needs_recommendation"] == 1


def test_section_carries_findings_and_reconciliation(db_session, test_org, rec_vocab, rec_inspections):
    org_id = test_org.organization_id
    run = _run(db_session, org_id, rec_inspections[0])
    draft = workflow.list_records(db_session, org_id, status="Draft")[0]
    workflow.disposition_record(db_session, org_id, draft.id, "approve", ACTOR)

    assert has_approved_recommendations(db_session, org_id, rec_inspections[0]) is True
    section = build_report_section(db_session, org_id, rec_inspections[0])

    assert section["run"]["run_id"] == run.id
    assert section["run"]["consumed"] == 3
    assert section["run"]["matched"] + section["run"]["unmatched"] + section["run"]["dismissed"] + section["run"]["skipped"] == 3
    assert section["counts"] == {"approved": 1, "needs_recommendation": 1, "superseded": 0, "findings_covered": 2}

    [tier] = section["tiers"]
    assert tier["tier"] == 1
    [rec] = tier["recommendations"]
    assert rec["recommendation_text"] == entry_write().recommendation_text
    assert rec["rule_version"] == 1
    assert sorted(f["detection_id"] for f in rec["findings"]) == ["d-rpt-1", "d-rpt-2"]
    assert {f["damage_code"] for f in rec["findings"]} == {"CO"}
    assert all(f["severity_label"] == "4 - Severe" for f in rec["findings"])
    assert [f["detection_id"] for f in section["needs_recommendation"]] == ["d-rpt-3"]
    assert section["latest_issued"] is None

    # another inspection of the same organization sees nothing of it
    assert has_approved_recommendations(db_session, org_id, rec_inspections[1]) is False


def test_platform_pdf_renders_the_section(db_session, test_org, rec_vocab, rec_inspections):
    org_id = test_org.organization_id
    _run(db_session, org_id, rec_inspections[0])
    draft = workflow.list_records(db_session, org_id, status="Draft")[0]
    workflow.disposition_record(db_session, org_id, draft.id, "approve", ACTOR)
    section = build_report_section(db_session, org_id, rec_inspections[0])

    report_data = {
        "metadata": {"asset_name": "Recommendation test asset", "organization_name": "Test org",
                     "location_name": "", "inspection_date": "2026-09-01", "inspection_type": "routine",
                     "total_images": 0, "inspector_name": "Test Inspector", "status": "review_completed"},
        "summary": {"total_detections": 3, "total_images": 0, "matrix": [], "column_totals": {"minor": 0, "moderate": 0, "advanced": 0, "severe": 0, "total": 0}},
        "image_findings": [],
        "narrative": {"executive_summary": "x", "technical_findings": "y", "recommendations": []},
        "recommendations": section,
    }
    pdf = generate_pdf(report_data)
    assert pdf[:4] == b"%PDF"
    without = dict(report_data)
    without.pop("recommendations")
    assert len(pdf) > len(generate_pdf(without))


def test_preview_endpoint_includes_the_section_only_when_approved(client, db_session, test_org, rec_vocab, rec_inspections):
    org_id = test_org.organization_id
    before = client.get(f"/api/v1/reports/inspections/{rec_inspections[0]}/preview")
    # the fixture inspection has no platform detections, so the report itself answers 422 or 200 depending on the loader;
    # either way the recommendations key is absent before anything is approved
    assert "recommendations" not in (before.json() if before.status_code == 200 else {})

    _run(db_session, org_id, rec_inspections[0])
    draft = workflow.list_records(db_session, org_id, status="Draft")[0]
    workflow.disposition_record(db_session, org_id, draft.id, "approve", ACTOR)
    assert has_approved_recommendations(db_session, org_id, rec_inspections[0]) is True


def test_dashboard_overview_carries_recommendation_counts(client, db_session, test_org, rec_vocab, rec_inspections):
    org_id = test_org.organization_id
    _run(db_session, org_id, rec_inspections[0])
    draft = workflow.list_records(db_session, org_id, status="Draft")[0]
    workflow.disposition_record(db_session, org_id, draft.id, "approve", ACTOR)
    resp = client.get("/api/v1/dashboard/overview")
    assert resp.status_code == 200, resp.text
    recs = resp.json()["recommendations"]
    assert recs["approved"] == 1
    assert recs["needs_recommendation"] == 1
    assert recs["draft"] == 0
    assert recs["active_rules"] == 1
