"""WFL-2 through WFL-5, WFL-8. Ported from Tahya's Phase-1 service
(tests/test_workflow.py) at the service layer.

One test is deliberately inverted from her original, per
Port_Test_Audit.xlsx: bulk disposition with no filter at all used to
mean "every Draft record system-wide" -- a client bug sending an empty
id list fell through to the same footgun. It's now a rejection; see
workflow.bulk_disposition's docstring comment for the fix.
"""

import pytest

from app.services.recommendations import authoring, engine, workflow
from app.services.recommendations.audit import list_audit_events
from app.services.recommendations.errors import FieldValidationError, NotFoundError
from tests.recommendations.conftest import entry_write, make_detection


def run_one_detection(db_session, org_id, **detection_overrides):
    authoring.create_entry(db_session, org_id, entry_write(severity=4))
    detection_overrides.setdefault("severity", 4)
    d = make_detection("d1", **detection_overrides)
    run = engine.run_resolution(db_session, org_id, "inspection-1", [d], "asset", "engineer@example.com")
    return engine.get_records_for_run(db_session, run.id)[0]


class TestDisposition:
    def test_approving_a_draft_record(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        updated = workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")
        assert updated.status == "Approved"

    def test_rejecting_a_draft_record(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        updated = workflow.disposition_record(db_session, test_org.organization_id, record.id, "reject", "engineer@example.com")
        assert updated.status == "Rejected"

    def test_cannot_disposition_a_needs_recommendation_record(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id, detection_class="nothing has a rule for this", severity=1)
        assert record.status == "Needs Recommendation"
        with pytest.raises(FieldValidationError):
            workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")

    def test_cannot_disposition_an_already_approved_record(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")
        with pytest.raises(FieldValidationError):
            workflow.disposition_record(db_session, test_org.organization_id, record.id, "reject", "engineer@example.com")

    def test_disposition_does_not_touch_the_library_entry(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        d = make_detection("d1", severity=4)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")

        after = authoring.get_entry_history(db_session, test_org.organization_id, entry.entry_id)[0]
        assert after.version == entry.version
        assert after.recommendation_text == entry.recommendation_text

    def test_disposition_writes_an_audit_event(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")
        events = list_audit_events(db_session, test_org.organization_id, entity_id=record.id)
        approved = [e for e in events if e.action == "record_approved"]
        assert len(approved) == 1
        assert approved[0].actor == "engineer@example.com"

    def test_rejecting_writes_the_correctly_spelled_audit_action(self, db_session, test_org, rec_vocab):
        # "reject" + "d" is "rejectd", not "rejected" -- worth pinning down
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "reject", "engineer@example.com")
        events = list_audit_events(db_session, test_org.organization_id, entity_id=record.id)
        rejected = [e for e in events if e.action == "record_rejected"]
        assert len(rejected) == 1


class TestBulkDisposition:
    def test_bulk_approve_by_explicit_ids(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, asset_id=f"asset-{i}") for i in range(3)]
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        record_ids = [r.id for r in engine.get_records_for_run(db_session, run.id)]

        result = workflow.bulk_disposition(db_session, test_org.organization_id, "approve", "engineer@example.com", record_ids=record_ids)
        assert set(result["succeeded"]) == set(record_ids)
        assert result["skipped"] == []

    def test_bulk_disposition_skips_non_draft_records(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")

        result = workflow.bulk_disposition(db_session, test_org.organization_id, "reject", "engineer@example.com", record_ids=[record.id])
        assert result["succeeded"] == []
        assert len(result["skipped"]) == 1

    def test_bulk_disposition_by_scope_filter_without_naming_ids(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, asset_id="asset-shared") for i in range(3)]
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")

        result = workflow.bulk_disposition(
            db_session, test_org.organization_id, "approve", "engineer@example.com",
            rollup_scope="asset", scope_key="asset-shared",
        )
        assert len(result["succeeded"]) == 1  # they consolidated into one record

    def test_bulk_disposition_with_no_filter_is_rejected(self, db_session, test_org, rec_vocab):
        # fixed in the port: no filter at all no longer means "every
        # Draft org-wide" -- bulk disposition must be told what it's for
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="corrosion", severity=4))
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="cracking", severity=2))
        detections = [
            make_detection("d1", detection_class="corrosion", severity=4),
            make_detection("d2", detection_class="cracking", severity=2),
        ]
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")

        with pytest.raises(FieldValidationError):
            workflow.bulk_disposition(db_session, test_org.organization_id, "approve", "engineer@example.com")

    def test_bulk_disposition_with_explicit_empty_list_is_rejected(self, db_session, test_org, rec_vocab):
        # the other half of the same fix: an empty list must not be
        # silently treated the same as "no ids given"
        with pytest.raises(FieldValidationError):
            workflow.bulk_disposition(db_session, test_org.organization_id, "approve", "engineer@example.com", record_ids=[])


class TestRejectionQueue:
    def test_rejected_records_are_listable(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "reject", "engineer@example.com")

        rejected = workflow.list_records(db_session, test_org.organization_id, status="Rejected")
        assert len(rejected) == 1
        assert rejected[0].id == record.id

    def test_rejected_records_still_show_up_in_reconciliation(self, db_session, test_org, rec_vocab):
        # WFL-5: never deleted, never excluded from the counts
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "reject", "engineer@example.com")
        summary = workflow.get_status_summary(db_session, test_org.organization_id)
        assert summary["counts"]["Rejected"] == 1


class TestStatusSummary:
    def test_counts_every_status(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="corrosion", severity=4))
        detections = [
            make_detection("d1", detection_class="corrosion", severity=4),
            make_detection("d2", detection_class="no rule for this one", severity=1),
        ]
        engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")

        summary = workflow.get_status_summary(db_session, test_org.organization_id)
        assert summary["counts"]["Draft"] == 1
        assert summary["counts"]["Needs Recommendation"] == 1
        assert summary["review_incomplete"] is True

    def test_review_complete_once_nothing_pending_remains(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        workflow.disposition_record(db_session, test_org.organization_id, record.id, "approve", "engineer@example.com")
        summary = workflow.get_status_summary(db_session, test_org.organization_id)
        assert summary["counts"]["Draft"] == 0
        assert summary["counts"]["Needs Recommendation"] == 0
        assert summary["review_incomplete"] is False


class TestDeltaView:
    def test_non_successor_record_has_no_delta(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        with pytest.raises(FieldValidationError):
            workflow.get_record_delta(db_session, test_org.organization_id, record.id)

    def test_successor_record_shows_departed_and_unchanged(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        detections = [make_detection(f"d{i}", severity=4, chain_key=f"chain-{i}", asset_id="asset-1") for i in range(3)]
        first = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        record_id = engine.get_records_for_run(db_session, first.id)[0].id
        workflow.disposition_record(db_session, test_org.organization_id, record_id, "approve", "engineer@example.com")

        corrected = make_detection("d0-corrected", severity=1, chain_key="chain-0", asset_id="asset-1")
        refreshed = [corrected, detections[1], detections[2]]
        second = engine.rerun_resolution(db_session, test_org.organization_id, "inspection-1", refreshed, "asset", "engineer@example.com")
        successor = next(r for r in engine.get_records_for_run(db_session, second.id) if r.supersedes_record_id == record_id)

        delta = workflow.get_record_delta(db_session, test_org.organization_id, successor.id)
        assert delta["supersedes_record_id"] == record_id
        assert "chain-0" in delta["departed_detection_ids"]
        assert "chain-1" in delta["unchanged_detection_ids"]
        assert "chain-2" in delta["unchanged_detection_ids"]
        assert delta["added_detection_ids"] == []


class TestAssignEntry:
    """WFL-2's other Needs Recommendation -> Draft path: picking an entry
    by hand instead of waiting on a rerun to find one automatically."""

    def test_assigning_an_entry_moves_the_record_to_draft(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="spalling", severity=1))
        d = make_detection("d1", detection_class="nothing matches this yet", severity=2)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]
        assert record.status == "Needs Recommendation"

        updated = workflow.assign_entry(db_session, test_org.organization_id, record.id, entry.entry_id, "engineer@example.com")
        assert updated.status == "Draft"
        assert updated.matched_entry_id == entry.entry_id
        assert updated.matched_entry_version == entry.version

    def test_cannot_assign_an_entry_to_a_record_that_already_matched(self, db_session, test_org, rec_vocab):
        record = run_one_detection(db_session, test_org.organization_id)
        assert record.status == "Draft"
        other_entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="spalling", severity=1))

        with pytest.raises(FieldValidationError):
            workflow.assign_entry(db_session, test_org.organization_id, record.id, other_entry.entry_id, "engineer@example.com")

    def test_assigning_a_nonexistent_entry_is_rejected(self, db_session, test_org, rec_vocab):
        d = make_detection("d1", detection_class="nothing matches this yet", severity=2)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]

        with pytest.raises(NotFoundError):
            workflow.assign_entry(db_session, test_org.organization_id, record.id, "does-not-exist", "engineer@example.com")

    def test_assigning_an_archived_entry_is_rejected(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="spalling", severity=1))
        authoring.archive_entry(db_session, test_org.organization_id, entry.entry_id, "engineer@example.com")
        d = make_detection("d1", detection_class="nothing matches this yet", severity=2)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]

        with pytest.raises(FieldValidationError):
            workflow.assign_entry(db_session, test_org.organization_id, record.id, entry.entry_id, "engineer@example.com")

    def test_assigning_an_entry_writes_an_audit_event(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="spalling", severity=1))
        d = make_detection("d1", detection_class="nothing matches this yet", severity=2)
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        record = engine.get_records_for_run(db_session, run.id)[0]

        workflow.assign_entry(db_session, test_org.organization_id, record.id, entry.entry_id, "engineer@example.com")
        events = list_audit_events(db_session, test_org.organization_id, entity_id=record.id)
        assigned = [e for e in events if e.action == "record_entry_assigned"]
        assert len(assigned) == 1
        assert assigned[0].actor == "engineer@example.com"
