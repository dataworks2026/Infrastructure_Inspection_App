"""Baseline Rev B 8.3, Reopen (CTO decision 2026-09-09).

Reopening an inspection deletes its engineer detections on the platform
side. These tests pin what the engine does in that same transaction:
dispositioned records supersede with lineage and a reason, unsigned records
are discarded, and the link set of a superseded record stays readable.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.recommendation import RecommendationDetectionLink, RecommendationRecord
from app.services.recommendations import authoring, engine, workflow
from app.services.recommendations.audit import list_audit_events
from app.services.recommendations.errors import FieldValidationError
from tests.recommendations.conftest import entry_write, make_detection

ACTOR = "engineer@example.com"


def _seed_inspection(db, org_id, inspection_id, *, approve: bool):
    """One matched record (Approved when asked) plus one Needs Recommendation
    record on the given inspection. Returns (matched_record, unmatched_record)."""
    matched = make_detection(f"{inspection_id}-d1", severity=4, inspection_id=inspection_id, asset_id=f"asset-{inspection_id}")
    unmatched = make_detection(
        f"{inspection_id}-d2", detection_class="nothing has a rule for this", severity=1,
        inspection_id=inspection_id, asset_id=f"asset-{inspection_id}",
    )
    run = engine.run_resolution(db, org_id, inspection_id, [matched, unmatched], "asset", ACTOR)
    records = engine.get_records_for_run(db, run.id)
    matched_record = next(r for r in records if r.status == "Draft")
    unmatched_record = next(r for r in records if r.status == "Needs Recommendation")
    if approve:
        workflow.disposition_record(db, org_id, matched_record.id, "approve", ACTOR)
    return matched_record, unmatched_record


@pytest.fixture
def library(db_session, test_org, rec_vocab):
    authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
    return test_org.organization_id


class TestReopenSupersedesDispositioned:
    def test_approved_record_becomes_superseded_with_lineage_and_reason(self, db_session, library):
        approved, _ = _seed_inspection(db_session, library, "inspection-1", approve=True)

        result = engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "engineer re-reviewing image 4")

        db_session.refresh(approved)
        assert result["superseded"] == [approved.id]
        assert approved.status == "Superseded"
        assert approved.supersede_reason == "inspection_reopened"
        assert approved.reopen_reason == "engineer re-reviewing image 4"
        assert approved.superseded_at is not None

    def test_no_successor_is_created(self, db_session, library):
        approved, _ = _seed_inspection(db_session, library, "inspection-1", approve=True)
        engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")

        successors = db_session.query(RecommendationRecord).filter(
            RecommendationRecord.supersedes_record_id == approved.id
        ).all()
        assert successors == []

    def test_superseded_record_stays_readable_through_its_links(self, db_session, library):
        approved, _ = _seed_inspection(db_session, library, "inspection-1", approve=True)
        engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")

        # the source detection row is gone on the platform side by now; the
        # link still tells the whole story on its own
        assert engine.get_detection_ids(db_session, approved.id) == ["inspection-1-d1"]
        assert engine.get_detection_classes(db_session, approved.id) == {"inspection-1-d1": "corrosion"}
        assert engine.get_detection_severities(db_session, approved.id) == {"inspection-1-d1": 4}

    def test_rejected_record_is_superseded_too(self, db_session, library):
        draft, _ = _seed_inspection(db_session, library, "inspection-1", approve=False)
        workflow.disposition_record(db_session, library, draft.id, "reject", ACTOR)

        engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")

        db_session.refresh(draft)
        assert draft.status == "Superseded"
        assert draft.supersede_reason == "inspection_reopened"


class TestReopenDiscardsUnsigned:
    def test_draft_and_needs_recommendation_records_are_deleted_with_their_links(self, db_session, library):
        draft, unmatched = _seed_inspection(db_session, library, "inspection-1", approve=False)

        result = engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")

        assert sorted(result["discarded"]) == sorted([draft.id, unmatched.id])
        assert result["superseded"] == []
        assert db_session.get(RecommendationRecord, draft.id) is None
        assert db_session.get(RecommendationRecord, unmatched.id) is None
        remaining_links = db_session.query(RecommendationDetectionLink).filter(
            RecommendationDetectionLink.record_id.in_([draft.id, unmatched.id])
        ).count()
        assert remaining_links == 0

    def test_a_later_run_rebuilds_them_and_leaves_the_superseded_record_alone(self, db_session, library):
        approved, _ = _seed_inspection(db_session, library, "inspection-1", approve=True)
        engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")

        fresh = make_detection("inspection-1-d1-v2", severity=4, inspection_id="inspection-1", asset_id="asset-inspection-1")
        rerun = engine.rerun_resolution(db_session, library, "inspection-1", [fresh], "asset", ACTOR)

        db_session.refresh(approved)
        assert approved.status == "Superseded"
        assert approved.supersede_reason == "inspection_reopened"
        new_records = engine.get_records_for_run(db_session, rerun.id)
        assert [r.status for r in new_records] == ["Draft"]
        assert new_records[0].supersedes_record_id is None


class TestReopenScopeAndGuards:
    def test_other_inspections_are_untouched(self, db_session, library):
        _seed_inspection(db_session, library, "inspection-1", approve=True)
        other_approved, other_unmatched = _seed_inspection(db_session, library, "inspection-2", approve=True)

        engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")

        db_session.refresh(other_approved)
        assert other_approved.status == "Approved"
        assert db_session.get(RecommendationRecord, other_unmatched.id) is not None

    def test_a_reopen_without_a_reason_is_rejected_and_changes_nothing(self, db_session, library):
        approved, unmatched = _seed_inspection(db_session, library, "inspection-1", approve=True)

        for blank in ("", "   ", None):
            with pytest.raises(FieldValidationError) as exc:
                engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, blank)
            assert exc.value.field == "reopen_reason"

        db_session.refresh(approved)
        assert approved.status == "Approved"
        assert db_session.get(RecommendationRecord, unmatched.id) is not None

    def test_reopen_is_written_to_the_audit_ledger(self, db_session, library):
        approved, unmatched = _seed_inspection(db_session, library, "inspection-1", approve=True)

        engine.supersede_for_reopen(db_session, library, "inspection-1", "reviewer@example.com", "second opinion requested")

        per_record = [e for e in list_audit_events(db_session, library, entity_id=approved.id) if e.action == "record_superseded"]
        assert len(per_record) == 1
        assert per_record[0].actor == "reviewer@example.com"
        assert per_record[0].detail["supersede_reason"] == "inspection_reopened"
        assert per_record[0].detail["reopen_reason"] == "second opinion requested"
        assert per_record[0].detail["successor_record_id"] is None

        inspection_events = [e for e in list_audit_events(db_session, library, entity_id="inspection-1") if e.action == "inspection_reopened"]
        assert len(inspection_events) == 1
        assert inspection_events[0].detail["superseded"] == [approved.id]
        assert inspection_events[0].detail["discarded"] == [unmatched.id]


class TestReopenDatabaseEnforcement:
    def test_superseded_without_a_reason_is_rejected_by_the_database(self, db_session, library):
        draft, _ = _seed_inspection(db_session, library, "inspection-1", approve=False)
        with pytest.raises(IntegrityError):
            db_session.execute(
                text("UPDATE recommendation_records SET status = 'Superseded' WHERE id = :id"),
                {"id": draft.id},
            )
            db_session.flush()
        db_session.rollback()

    def test_reopen_reason_on_a_chain_changed_supersede_is_rejected_by_the_database(self, db_session, library):
        draft, _ = _seed_inspection(db_session, library, "inspection-1", approve=False)
        with pytest.raises(IntegrityError):
            db_session.execute(
                text(
                    "UPDATE recommendation_records SET status = 'Superseded', supersede_reason = 'chain_changed', "
                    "reopen_reason = 'not allowed here' WHERE id = :id"
                ),
                {"id": draft.id},
            )
            db_session.flush()
        db_session.rollback()

    def test_links_of_a_superseded_record_are_frozen_by_the_trigger(self, db_session, library):
        if db_session.bind.dialect.name != "postgresql":
            pytest.skip("DAT-5's link-immutability trigger is enforced by a Postgres-only construct; runs on the Postgres CI job")
        approved, _ = _seed_inspection(db_session, library, "inspection-1", approve=True)
        engine.supersede_for_reopen(db_session, library, "inspection-1", ACTOR, "reason")
        with pytest.raises(DBAPIError):
            db_session.execute(
                text("DELETE FROM recommendation_detection_links WHERE record_id = :id"), {"id": approved.id}
            )
            db_session.flush()
        db_session.rollback()
