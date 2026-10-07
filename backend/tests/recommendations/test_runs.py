"""MAT-1, MAT-4, MAT-5, MAT-6 (extended), MAT-7, MAT-8, MAT-9, DAT-4.
Ported from Tahya's Phase-1 service (tests/test_runs.py) at the service
layer, since detections now arrive as MatchableDetection objects
(detection_feed.py's Stage-2 contract) rather than a POSTed JSON export
-- there is no request payload to build here at all. rollup_scope drops
'mission' in favor of 'inspection' per baseline §8.3; 'asset' stays the
practical default callers pass (nothing here defaults it implicitly --
that's a Stage 2/3 adapter/router decision, same as who chooses it was
always an API-layer concern in her version too).

Her four preview tests and the fixture-shape test are rewritten rather
than ported outright, per Port_Test_Audit.xlsx: preview's input contract
changed completely, and the fixture-shape assertion is superseded by the
Stage-2 golden-file gate against the real dataset. What ports is the
preview *behavior* itself (matched/unmatched/dismissed, no persistence,
no audit event) plus a new skipped case Reconciliation 3 introduced.
"""

from app.services.recommendations import authoring, engine
from app.services.recommendations.audit import list_audit_events
from tests.recommendations.conftest import entry_write, make_detection


class TestPreview:
    """engine.preview_matches: what a detection would match, without
    persisting anything."""

    def test_preview_shows_the_recommendation_without_persisting_anything(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)

        results = engine.preview_matches(db_session, test_org.organization_id, [d])
        preview = results[0]
        assert preview["matched"] is True
        assert preview["dismissed"] is False
        assert preview["skipped"] is False
        assert preview["recommendation_text"] == entry.recommendation_text
        assert preview["action_class"] == entry.action_class
        assert preview["tier"] == entry.derived_tier

        # nothing got written anywhere
        from app.services.recommendations import workflow
        summary = workflow.get_status_summary(db_session, test_org.organization_id)
        assert sum(summary["counts"].values()) == 0

    def test_preview_of_an_unmatched_detection(self, db_session, test_org, rec_vocab):
        d = make_detection("d1", detection_class="nothing has a rule for this", severity=1)
        preview = engine.preview_matches(db_session, test_org.organization_id, [d])[0]
        assert preview["matched"] is False
        assert preview["dismissed"] is False
        assert preview["recommendation_text"] is None

    def test_preview_of_a_dismissed_detection(self, db_session, test_org, rec_vocab):
        d = make_detection("d1", severity=4, dismissed=True)
        preview = engine.preview_matches(db_session, test_org.organization_id, [d])[0]
        assert preview["dismissed"] is True
        assert preview["matched"] is False

    def test_preview_of_a_skipped_detection(self, db_session, test_org, rec_vocab):
        # Reconciliation 3: a detection the adapter could not resolve
        # (null/invalid severity, unscopable) is surfaced, not silently
        # dropped, even in a read-only preview.
        d = make_detection("d1", severity=4, skip_reason="invalid_severity")
        preview = engine.preview_matches(db_session, test_org.organization_id, [d])[0]
        assert preview["skipped"] is True
        assert preview["skip_reason"] == "invalid_severity"
        assert preview["matched"] is False

    def test_preview_writes_no_audit_event(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        before = len(list_audit_events(db_session, test_org.organization_id))
        d = make_detection("d1", severity=4)
        engine.preview_matches(db_session, test_org.organization_id, [d])
        after = len(list_audit_events(db_session, test_org.organization_id))
        assert after == before


class TestBasicRun:
    def test_matched_detection_produces_a_draft_record(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4, asset_id="asset-1")

        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        assert run.total_detections == 1
        assert run.total_matched == 1
        assert run.total_unmatched == 0

        records = engine.get_records_for_run(db_session, run.id)
        assert len(records) == 1
        record = records[0]
        assert record.status == "Draft"
        assert record.matched_entry_id == entry.entry_id
        assert record.matched_entry_version == entry.version
        assert engine.get_detection_ids(db_session, record.id) == [d.id]

    def test_unmatched_detection_becomes_needs_recommendation(self, db_session, test_org, rec_vocab):
        d = make_detection("d1", detection_class="some brand new class", severity=1)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        assert run.total_unmatched == 1
        records = engine.get_records_for_run(db_session, run.id)
        assert records[0].status == "Needs Recommendation"
        assert records[0].matched_entry_id is None

    def test_dismissed_detection_excluded_and_counted(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4, dismissed=True)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        assert run.total_dismissed == 1
        assert run.total_matched == 0
        assert engine.get_records_for_run(db_session, run.id) == []

    def test_reconciliation_always_adds_up(self, db_session, test_org, rec_vocab):
        # MAT-6, extended: matched + unmatched + dismissed + skipped must
        # equal total, always
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [
            make_detection("d1", severity=4),
            make_detection("d2", detection_class="nothing matches this", severity=1),
            make_detection("d3", severity=4, dismissed=True),
            make_detection("d4", severity=4, skip_reason="invalid_severity"),
        ]
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        assert run.total_matched + run.total_unmatched + run.total_dismissed + run.total_skipped == run.total_detections
        assert run.total_skipped == 1
        assert run.skipped_manifest == [{"detection_id": "d4", "reason": "invalid_severity"}]


class TestConfidenceVisibility:
    """MAT-10: severity decides the match (see test_matching.py), but
    confidence still needs to be stored and visible to a reviewer."""

    def test_confidence_is_stored_and_returned_per_detection(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4, confidence=0.63)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        assert engine.get_detection_confidences(db_session, record.id)[d.id] == 0.63

    def test_a_low_confidence_detection_still_matches_and_shows_its_score(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4, confidence=0.05)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        assert record.status == "Draft"
        assert engine.get_detection_confidences(db_session, record.id)[d.id] == 0.05


class TestConsolidation:
    """MAT-7, MAT-8."""

    def test_same_entry_same_scope_consolidates_into_one_record(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, asset_id="asset-1") for i in range(14)]
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        records = engine.get_records_for_run(db_session, run.id)
        assert len(records) == 1
        assert set(engine.get_detection_ids(db_session, records[0].id)) == {d.id for d in detections}

    def test_same_entry_different_asset_scope_does_not_consolidate(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, asset_id=f"asset-{i}") for i in range(2)]
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        assert len(engine.get_records_for_run(db_session, run.id)) == 2

    def test_rollup_scope_per_inspection_groups_across_assets(self, db_session, test_org, rec_vocab):
        # baseline §8.3 drops the mission scope in favor of inspection --
        # same idea, different grouping key: different assets, same
        # inspection and same matched entry, so one record.
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [
            make_detection(f"d{i}", severity=4, asset_id=f"asset-{i}", inspection_id="inspection-shared")
            for i in range(3)
        ]
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-shared", detections, "inspection", "engineer@example.com")
        records = engine.get_records_for_run(db_session, run.id)
        assert len(records) == 1
        assert len(engine.get_detection_ids(db_session, records[0].id)) == 3


class TestVersionPinning:
    """MAT-9: later library edits never alter an already generated record."""

    def test_editing_the_entry_after_the_run_does_not_change_the_record(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        assert record.matched_entry_version == 1

        authoring.edit_entry(
            db_session, test_org.organization_id, entry.entry_id,
            entry_write(severity=4, recommendation_text="completely different wording now"),
        )

        db_session.refresh(record)
        assert record.matched_entry_version == 1


class TestDeterminism:
    """MAT-4."""

    def test_same_input_twice_produces_the_same_matches(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="corrosion", severity=4))
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="cracking", severity=2))
        detections = [
            make_detection("d1", detection_class="corrosion", severity=4),
            make_detection("d2", detection_class="cracking", severity=2),
            make_detection("d3", detection_class="unmatched thing", severity=1),
        ]
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        second = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")

        assert first.total_matched == second.total_matched
        assert first.total_unmatched == second.total_unmatched
