"""OUT-1 through OUT-3. Ported from Tahya's Phase-1 service
(tests/test_output.py) at the service layer.

Two tests are deliberately inverted, per Port_Test_Audit.xlsx:
build_output no longer writes an audit event on every call (a GET with a
side effect, and an uncorrelatable one -- see output.py's docstring), so
there's no "default actor" concept left to test either. What replaces
them is a single test proving the read really is now free of side
effects, in both senses.
"""

from app.services.recommendations import authoring, engine, output, workflow
from app.services.recommendations.audit import list_audit_events
from tests.recommendations.conftest import entry_write, make_detection


def approve_one_detection(db_session, org_id, **detection_overrides):
    authoring.create_entry(db_session, org_id, entry_write(severity=4))
    detection_overrides.setdefault("severity", 4)
    d = make_detection("d1", **detection_overrides)
    run = engine.run_resolution(db_session, org_id, "inspection-1", [d], "asset", "engineer@example.com")
    record = engine.get_records_for_run(db_session, run.id)[0]
    workflow.disposition_record(db_session, org_id, record.id, "approve", "engineer@example.com")
    return record, d


class TestOnlyApprovedRenders:
    def test_draft_record_does_not_render(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        result = output.build_output(db_session, test_org.organization_id)
        assert result["tiers"] == []

    def test_rejected_record_does_not_render(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "reject", "engineer@example.com")
        result = output.build_output(db_session, test_org.organization_id)
        assert result["tiers"] == []

    def test_needs_recommendation_does_not_render_but_shows_in_summary(self, db_session, test_org, rec_vocab):
        d = make_detection("d1", detection_class="no rule yet", severity=1)
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        result = output.build_output(db_session, test_org.organization_id)
        assert result["tiers"] == []
        assert result["summary"]["needs_recommendation_count"] == 1

    def test_approved_record_renders(self, db_session, test_org, rec_vocab):
        approve_one_detection(db_session, test_org.organization_id)
        result = output.build_output(db_session, test_org.organization_id)
        all_recs = [r for t in result["tiers"] for r in t["recommendations"]]
        assert len(all_recs) == 1

    def test_superseded_record_does_not_render_but_counts_in_summary(self, db_session, test_org, rec_vocab):
        record, d = approve_one_detection(db_session, test_org.organization_id, chain_key="chain-1")

        corrected = make_detection("d1-corrected", severity=1, chain_key="chain-1")
        engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [corrected], "asset", "engineer@example.com")

        from app.models.recommendation import RecommendationRecord
        assert db_session.get(RecommendationRecord, record.id).status == "Superseded"

        result = output.build_output(db_session, test_org.organization_id)
        all_recs = [r for t in result["tiers"] for r in t["recommendations"]]
        assert record.id not in [r["record_id"] for r in all_recs]
        assert result["summary"]["superseded_count"] == 1


class TestRenderContent:
    def test_recommendation_text_and_action_class_render_verbatim(self, db_session, test_org, rec_vocab):
        authoring.create_entry(
            db_session, test_org.organization_id,
            entry_write(severity=4, recommendation_text="  Replace the anode and repaint.  ", action_class="corrosion mitigation"),
        )
        d = make_detection("d1", severity=4)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")

        result = output.build_output(db_session, test_org.organization_id)
        rec = result["tiers"][0]["recommendations"][0]
        assert rec["recommendation_text"] == "Replace the anode and repaint."
        assert rec["action_class"] == "corrosion mitigation"

    def test_tier_grouping_by_effective_tier(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="corrosion", severity=4))
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="cracking", severity=1))
        detections = [
            make_detection("d1", detection_class="corrosion", severity=4, asset_id="asset-1"),
            make_detection("d2", detection_class="cracking", severity=1, asset_id="asset-2"),
        ]
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        workflow.bulk_disposition(db_session, test_org.organization_id, "approve", "engineer@example.com", rollup_scope="asset", scope_key="asset-1")
        workflow.bulk_disposition(db_session, test_org.organization_id, "approve", "engineer@example.com", rollup_scope="asset", scope_key="asset-2")

        result = output.build_output(db_session, test_org.organization_id)
        tiers_present = {t["tier"] for t in result["tiers"]}
        assert tiers_present == {1, 3}
        tier_1 = next(t for t in result["tiers"] if t["tier"] == 1)
        assert tier_1["label"] == "Immediate action"

    def test_tier_override_wins_over_derived_tier(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="cracking", severity=1, tier_override=1))
        d = make_detection("d1", detection_class="cracking", severity=1)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")

        result = output.build_output(db_session, test_org.organization_id)
        assert len(result["tiers"]) == 1
        assert result["tiers"][0]["tier"] == 1

    def test_consolidated_record_shows_quantity_and_locations(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [
            make_detection("d1", severity=4, asset_id="asset-1", location={"lat": 1.0, "lng": 2.0}),
            make_detection("d2", severity=4, asset_id="asset-1", location={"lat": 1.1, "lng": 2.1}),
            make_detection("d3", severity=4, asset_id="asset-1"),
        ]
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        workflow.bulk_disposition(db_session, test_org.organization_id, "approve", "engineer@example.com", rollup_scope="asset", scope_key="asset-1")

        result = output.build_output(db_session, test_org.organization_id)
        rec = result["tiers"][0]["recommendations"][0]
        assert rec["quantity"] == 3
        # only the two detections that actually had a location show up
        # here, the third one deliberately didn't have one
        assert len(rec["locations"]) == 2
        assert set(rec["detection_ids"]) == {d.id for d in detections}

    def test_summary_approved_counts_by_tier(self, db_session, test_org, rec_vocab):
        approve_one_detection(db_session, test_org.organization_id)
        result = output.build_output(db_session, test_org.organization_id)
        assert result["summary"]["approved_counts_by_tier"] == {1: 1}


class TestReproducibility:
    def test_calling_twice_gives_identical_content(self, db_session, test_org, rec_vocab):
        approve_one_detection(db_session, test_org.organization_id)
        first = output.build_output(db_session, test_org.organization_id)
        second = output.build_output(db_session, test_org.organization_id)
        first.pop("generated_at")
        second.pop("generated_at")
        assert first == second

    def test_output_still_renders_after_the_matched_entry_is_archived(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")

        # archiving doesn't delete the row, and output reads the pinned
        # version directly, so this proves it never re-runs the matcher
        authoring.archive_entry(db_session, test_org.organization_id, entry.entry_id, "engineer@example.com")

        result = output.build_output(db_session, test_org.organization_id)
        all_recs = [r for t in result["tiers"] for r in t["recommendations"]]
        assert len(all_recs) == 1
        assert all_recs[0]["recommendation_text"] == entry.recommendation_text


class TestOutputIsAReadOnlyView:
    """AUD-1's coverage of output generation moves to the report/export
    call sites (Stage 4), where output_generated can carry a real,
    correlatable entity_id (the inspection) -- see output.py's docstring.
    build_output itself is now provably side-effect-free, in both the
    sense OUT-3 already claimed (same content back) and the audit sense
    her original didn't quite have (nothing written on every call)."""

    def test_build_output_writes_no_audit_event(self, db_session, test_org, rec_vocab):
        approve_one_detection(db_session, test_org.organization_id)
        before = len(list_audit_events(db_session, test_org.organization_id))
        output.build_output(db_session, test_org.organization_id)
        output.build_output(db_session, test_org.organization_id)
        after = len(list_audit_events(db_session, test_org.organization_id))
        assert after == before
