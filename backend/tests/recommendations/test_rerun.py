"""MAT-11. Ported from Tahya's Phase-1 service (tests/test_rerun.py).

Her version modeled "a detection's severity changed" by literally
mutating the same dict's severity field between the first run and the
rerun call, since her ingestion had no concept of a stable identity
separate from the row itself. That doesn't carry over: platform severity
corrections arrive as a *new* engineer detection row (contract_deltas.md,
baseline §8.3), so a "corrected" detection here is a second
MatchableDetection with a different id but the SAME chain_key -- exactly
what detection_feed.py will actually hand the engine on a real 'modified'
review, and exactly the scenario that makes MAT-11's comparison mean
something on real data rather than only on a fixture shaped to fit it.

Disposition uses workflow.disposition_record() directly rather than a
raw SQL UPDATE -- her own comment noted the raw update was a stand-in
"since there's no disposition API yet"; that API exists now (ported
alongside this file), so there's no reason to bypass it.
"""

from app.services.recommendations import authoring, engine, workflow
from app.services.recommendations.audit import list_audit_events
from tests.recommendations.conftest import entry_write, make_detection


class TestNeedsRecommendationTransitionsToDraft:
    def test_gap_that_now_matches_becomes_draft(self, db_session, test_org, rec_vocab):
        # first run: no library entry exists yet, so it's unmatched
        d = make_detection("d1", severity=4)
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        assert engine.get_records_for_run(db_session, first.id)[0].status == "Needs Recommendation"

        # now author the entry it should match
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))

        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, second.id)[0]
        assert record.status == "Draft"
        assert record.matched_entry_id is not None


class TestUndispositionedRecordsRecompute:
    def test_draft_regenerates_when_severity_change_moves_it_to_a_different_entry(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=2))
        d_v1 = make_detection("d1", severity=4, chain_key="chain-1")

        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d_v1], "asset", "engineer@example.com")
        first_record = engine.get_records_for_run(db_session, first.id)[0]
        assert first_record.matched_entry_version == 1
        first_entry_id = first_record.matched_entry_id

        # severity corrected via a review -- a NEW detection row, same chain
        d_v2 = make_detection("d1-corrected", severity=2, chain_key="chain-1")
        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [d_v2], "asset", "engineer@example.com")
        second_records = engine.get_records_for_run(db_session, second.id)
        assert len(second_records) == 1
        assert second_records[0].matched_entry_id != first_entry_id
        assert second_records[0].status == "Draft"

    def test_identical_rerun_keeps_the_same_draft_record_id(self, db_session, test_org, rec_vocab):
        # F2: a rerun that computes the exact same group again shouldn't
        # hand it a new id -- a reviewer's reference to this record has to
        # keep working across a routine refresh
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, asset_id="asset-1") for i in range(3)]
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        first_records = engine.get_records_for_run(db_session, first.id)
        assert len(first_records) == 1
        record_id = first_records[0].id

        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        second_records = engine.get_records_for_run(db_session, second.id)
        assert len(second_records) == 1
        assert second_records[0].id == record_id

    def test_identical_rerun_keeps_the_same_needs_recommendation_id(self, db_session, test_org, rec_vocab):
        d = make_detection("d1", detection_class="nothing has a rule for this", severity=1)
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        first_record = engine.get_records_for_run(db_session, first.id)[0]
        assert first_record.status == "Needs Recommendation"

        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        assert engine.get_records_for_run(db_session, second.id)[0].id == first_record.id

    def test_editing_the_matched_entry_replaces_the_draft_with_the_new_version(self, db_session, test_org, rec_vocab):
        # a Draft isn't pinned the way an Approved record is (MAT-9 only
        # protects dispositioned records) -- so unlike an approved
        # record, editing the entry it matched *should* show up on the
        # next rerun
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        first_record = engine.get_records_for_run(db_session, first.id)[0]
        assert first_record.matched_entry_version == 1

        authoring.edit_entry(db_session, test_org.organization_id, entry.entry_id, entry_write(severity=4, recommendation_text="Updated text."))

        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        second_records = engine.get_records_for_run(db_session, second.id)
        assert len(second_records) == 1
        assert second_records[0].matched_entry_version == 2
        assert second_records[0].id != first_record.id

    def test_rerun_audit_event_lists_kept_removed_and_created_record_ids(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=2))
        # different scopes, so each becomes its own record on the first run
        stable = make_detection("stable", severity=4, chain_key="chain-stable", asset_id="asset-stable")
        changing_v1 = make_detection("changing", severity=4, chain_key="chain-changing", asset_id="asset-changing")

        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [stable, changing_v1], "asset", "engineer@example.com")
        first_records = engine.get_records_for_run(db_session, first.id)
        assert len(first_records) == 2
        stable_record_id = next(r.id for r in first_records if "stable" in engine.get_detection_ids(db_session, r.id))
        changing_record_id = next(r.id for r in first_records if "changing" in engine.get_detection_ids(db_session, r.id))

        # the changing detection is corrected to a severity that moves it
        # to a different entry; the stable one is untouched
        changing_v2 = make_detection("changing-corrected", severity=2, chain_key="chain-changing", asset_id="asset-changing")
        engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [stable, changing_v2], "asset", "engineer@example.com")

        events = list_audit_events(db_session, test_org.organization_id)
        rerun_event = next(e for e in events if e.action == "resolution_rerun")
        detail = rerun_event.detail
        assert stable_record_id not in detail["undispositioned_removed"]
        assert changing_record_id in detail["undispositioned_removed"]
        assert len(detail["undispositioned_created"]) >= 1


class TestDispositionedRecordsAreProtected:
    def test_untouched_when_nothing_about_its_contributors_changed(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record_id = engine.get_records_for_run(db_session, first.id)[0].id
        workflow.disposition_record(db_session, test_org.organization_id, record_id, "approve", "engineer@example.com")

        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")

        # the approved record isn't in this run's output at all, since
        # nothing about it changed and it was never touched
        assert record_id not in [r.id for r in engine.get_records_for_run(db_session, second.id)]


class TestSupersede:
    """ACC-3's exact scenario: an approved consolidated record, one
    contributor's chain changes, rerun."""

    def test_severity_change_on_one_contributor_supersedes_and_keeps_the_rest(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, chain_key=f"chain-{i}", asset_id="asset-1") for i in range(14)]
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        first_records = engine.get_records_for_run(db_session, first.id)
        assert len(first_records) == 1
        record_id = first_records[0].id
        assert len(engine.get_detection_ids(db_session, record_id)) == 14
        workflow.disposition_record(db_session, test_org.organization_id, record_id, "approve", "engineer@example.com")

        # chain-0's finding gets corrected to a severity nothing matches
        corrected = make_detection("d0-corrected", severity=1, chain_key="chain-0", asset_id="asset-1")
        refreshed = [corrected] + detections[1:]

        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", refreshed, "asset", "engineer@example.com")
        second_records = engine.get_records_for_run(db_session, second.id)

        # the old approved record isn't in this run's results (it's
        # Superseded, not touched further)
        assert record_id not in [r.id for r in second_records]

        successor = next(r for r in second_records if r.supersedes_record_id == record_id)
        assert successor.status == "Draft"
        assert len(engine.get_detection_ids(db_session, successor.id)) == 13
        assert "d0-corrected" not in engine.get_detection_ids(db_session, successor.id)

        # the departed chain re-resolved independently into its own record
        departed_records = [r for r in second_records if "d0-corrected" in engine.get_detection_ids(db_session, r.id)]
        assert len(departed_records) == 1
        assert departed_records[0].id != successor.id
        assert departed_records[0].status == "Needs Recommendation"  # severity 1 has no entry

    def test_old_record_is_marked_superseded_in_the_database(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4, chain_key="chain-1")
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record_id = engine.get_records_for_run(db_session, first.id)[0].id
        workflow.disposition_record(db_session, test_org.organization_id, record_id, "approve", "engineer@example.com")

        corrected = make_detection("d1-corrected", severity=1, chain_key="chain-1")
        engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", [corrected], "asset", "engineer@example.com")

        from app.models.recommendation import RecommendationRecord
        record = db_session.get(RecommendationRecord, record_id)
        assert record.status == "Superseded"

    def test_link_set_of_the_superseded_record_is_untouched(self, db_session, test_org, rec_vocab):
        # DAT-5: superseding never mutates the old record's own links, it
        # creates a new record instead
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, chain_key=f"chain-{i}", asset_id="asset-1") for i in range(2)]
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        record_id = engine.get_records_for_run(db_session, first.id)[0].id
        workflow.disposition_record(db_session, test_org.organization_id, record_id, "approve", "engineer@example.com")

        assert len(engine.get_detection_ids(db_session, record_id)) == 2

        corrected = make_detection("d0-corrected", severity=1, chain_key="chain-0", asset_id="asset-1")
        refreshed = [corrected, detections[1]]
        engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", refreshed, "asset", "engineer@example.com")

        assert len(engine.get_detection_ids(db_session, record_id)) == 2
