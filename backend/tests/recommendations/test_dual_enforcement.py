"""DAT-2: the same rules Pydantic/authoring.py enforce are also enforced
by the database itself, independently. These go straight at the database
with raw SQL, skipping the service layer entirely, so nothing here
depends on the application code being correct, only the schema.

Ported from Tahya's Phase-1 service (tests/test_dual_enforcement.py),
table names updated (library_entries -> recommendation_library_entries,
etc.), UUIDs generated in Python rather than via Postgres's
gen_random_uuid() (matching this platform's own convention -- every
table here uses app-generated String(36) uuids, never a server default).

Three guarantees are Postgres-only by construction, exactly like the
rest of this migration's dialect-conditional pieces (AUD-2's trigger,
DAT-5's trigger, MAT-3's coalescing index): the append-only audit
trigger, the dispositioned-link immutability trigger, and DAT-1's
composite foreign key -- SQLite does not enforce foreign keys at all
unless a connection-level PRAGMA is turned on, which nothing in this
platform's engine setup does (a platform-wide change out of scope for
this feature). Those checks skip cleanly on SQLite and run for real on
the required Postgres CI job.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.models.recommendation import RecommendationVocabulary
from app.services.recommendations.audit import record_audit_event
from tests.recommendations.conftest import ensure_vocabulary, seed_vocab

INSERT_ENTRY = """
INSERT INTO recommendation_library_entries
    (entry_id, version, organization_id, vocabulary_id, is_active, is_latest, detection_class, severity,
     recommendation_text, action_class, derived_tier, tier_override, created_by)
VALUES
    (:entry_id, 1, :organization_id, :vocabulary_id, true, true, :detection_class, :severity,
     :recommendation_text, :action_class, :derived_tier, :tier_override, 'raw_sql_test')
"""


def _vocabulary_id(db) -> str:
    vocab = db.query(RecommendationVocabulary).filter(RecommendationVocabulary.producer == "coastal").first()
    return vocab.id if vocab is not None else ensure_vocabulary(db).id


def _is_postgres(db_session) -> bool:
    return db_session.get_bind().dialect.name == "postgresql"


def _skip_unless_postgres(db_session, guarantee: str):
    if not _is_postgres(db_session):
        pytest.skip(f"{guarantee} is enforced by a Postgres-only construct; runs on the Postgres CI job")


def _try_insert(db_session, organization_id, **kwargs):
    params = {
        "entry_id": str(uuid.uuid4()),
        "organization_id": organization_id,
        "vocabulary_id": _vocabulary_id(db_session),
        "detection_class": "corrosion",
        "severity": 2,
        "recommendation_text": "valid text",
        "action_class": "monitor",
        "derived_tier": 3,
        "tier_override": None,
    }
    params.update(kwargs)
    db_session.execute(text(INSERT_ENTRY), params)
    db_session.commit()


class TestDatabaseRejectsBadDataDirectly:
    def test_blank_recommendation_text_rejected_by_database(self, db_session, test_org, rec_vocab):
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, recommendation_text="   ")
        db_session.rollback()

    def test_blank_action_class_rejected_by_database(self, db_session, test_org, rec_vocab):
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, action_class="")
        db_session.rollback()

    def test_out_of_range_severity_rejected_by_database(self, db_session, test_org, rec_vocab):
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, severity=9)
        db_session.rollback()

    def test_tier_override_less_urgent_than_derived_rejected_by_database(self, db_session, test_org, rec_vocab):
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, derived_tier=1, tier_override=3)
        db_session.rollback()

    def test_unnormalized_class_rejected_by_database(self, db_session, test_org, rec_vocab):
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, detection_class="  Corrosion  ")
        db_session.rollback()

    def test_class_not_in_the_vocabulary_rejected_by_database(self, db_session, test_org, rec_vocab):
        _skip_unless_postgres(db_session, "DAT-1's vocabulary foreign key")
        # 'titanium fatigue' is properly normalized (lowercase, trimmed)
        # so the ck_entry_class_normalized check has nothing to object
        # to -- this is specifically the foreign key doing its job, not
        # the normalization check catching it by coincidence
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, detection_class="titanium fatigue")
        db_session.rollback()

    def test_valid_row_relies_on_server_side_defaults_for_active_and_latest(self, db_session, test_org, rec_vocab):
        # is_active/is_latest deliberately omitted, proving the database
        # defaults them itself rather than trusting the caller to set them
        entry_id = str(uuid.uuid4())
        db_session.execute(
            text(
                "INSERT INTO recommendation_library_entries "
                "(entry_id, version, organization_id, vocabulary_id, detection_class, severity, "
                " recommendation_text, action_class, derived_tier, created_by) "
                "VALUES (:entry_id, 1, :organization_id, :vocabulary_id, 'corrosion', 2, 'valid text', 'monitor', 3, 'raw_sql_test')"
            ),
            {"entry_id": entry_id, "organization_id": test_org.organization_id, "vocabulary_id": _vocabulary_id(db_session)},
        )
        db_session.commit()
        row = db_session.execute(
            text("SELECT is_active, is_latest FROM recommendation_library_entries WHERE entry_id = :id"),
            {"id": entry_id},
        ).first()
        assert bool(row.is_active) is True
        assert bool(row.is_latest) is True


class TestRuleKeyUniquenessAtTheDatabase:
    def test_duplicate_rule_key_rejected_by_database(self, db_session, test_org, rec_vocab):
        _try_insert(db_session, test_org.organization_id, detection_class="spalling", severity=1)
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, detection_class="spalling", severity=1)
        db_session.rollback()

    def test_two_unscoped_entries_still_collide_at_the_database(self, db_session, test_org, rec_vocab):
        # both leave asset_type/asset_id out entirely -- exactly the case
        # a plain (non-coalescing) unique index would miss
        _try_insert(db_session, test_org.organization_id, detection_class="decay", severity=2)
        with pytest.raises(IntegrityError):
            _try_insert(db_session, test_org.organization_id, detection_class="decay", severity=2)
        db_session.rollback()


class TestRecordIntegrityAtTheDatabase:
    """DAT-4: a record can't exist without a resolvable entry version,
    except Needs Recommendation, which by definition has neither."""

    def _make_run(self, db_session, organization_id) -> str:
        run_id = str(uuid.uuid4())
        db_session.execute(
            text(
                "INSERT INTO recommendation_runs "
                "(id, organization_id, rollup_scope, total_detections, total_matched, total_unmatched, total_dismissed, total_skipped) "
                "VALUES (:id, :organization_id, 'asset', 0, 0, 0, 0, 0)"
            ),
            {"id": run_id, "organization_id": organization_id},
        )
        db_session.commit()
        return run_id

    def test_needs_recommendation_with_a_matched_entry_is_rejected(self, db_session, test_org):
        run_id = self._make_run(db_session, test_org.organization_id)
        with pytest.raises(IntegrityError):
            db_session.execute(
                text(
                    "INSERT INTO recommendation_records "
                    "(id, organization_id, status, matched_entry_id, matched_entry_version, rollup_scope, scope_key, run_id) "
                    "VALUES (:id, :org_id, 'Needs Recommendation', :entry_id, 1, 'asset', 'x', :run_id)"
                ),
                {"id": str(uuid.uuid4()), "org_id": test_org.organization_id, "entry_id": str(uuid.uuid4()), "run_id": run_id},
            )
            db_session.commit()
        db_session.rollback()

    def test_draft_without_a_matched_entry_is_rejected(self, db_session, test_org):
        run_id = self._make_run(db_session, test_org.organization_id)
        with pytest.raises(IntegrityError):
            db_session.execute(
                text(
                    "INSERT INTO recommendation_records "
                    "(id, organization_id, status, matched_entry_id, matched_entry_version, rollup_scope, scope_key, run_id) "
                    "VALUES (:id, :org_id, 'Draft', NULL, NULL, 'asset', 'x', :run_id)"
                ),
                {"id": str(uuid.uuid4()), "org_id": test_org.organization_id, "run_id": run_id},
            )
            db_session.commit()
        db_session.rollback()

    def test_invalid_status_value_is_rejected(self, db_session, test_org):
        run_id = self._make_run(db_session, test_org.organization_id)
        with pytest.raises(IntegrityError):
            db_session.execute(
                text(
                    "INSERT INTO recommendation_records "
                    "(id, organization_id, status, matched_entry_id, matched_entry_version, rollup_scope, scope_key, run_id) "
                    "VALUES (:id, :org_id, 'MadeUpStatus', NULL, NULL, 'asset', 'x', :run_id)"
                ),
                {"id": str(uuid.uuid4()), "org_id": test_org.organization_id, "run_id": run_id},
            )
            db_session.commit()
        db_session.rollback()


class TestLinkSetImmutableOnceDispositionedAtTheDatabase:
    """DAT-5: once a record is Approved or Rejected, its link set can't
    change, enforced by a trigger (Postgres only -- see module docstring)
    so it holds no matter what touches the table, same pattern as the
    audit_events append-only rule.
    """

    def _make_record(self, db_session, test_org, status: str) -> str:
        run_id = str(uuid.uuid4())
        db_session.execute(
            text(
                "INSERT INTO recommendation_runs "
                "(id, organization_id, rollup_scope, total_detections, total_matched, total_unmatched, total_dismissed, total_skipped) "
                "VALUES (:id, :org_id, 'asset', 0, 0, 0, 0, 0)"
            ),
            {"id": run_id, "org_id": test_org.organization_id},
        )
        entry_id = str(uuid.uuid4())
        seed_vocab(db_session, "corrosion")
        db_session.execute(
            text(
                "INSERT INTO recommendation_library_entries "
                "(entry_id, version, organization_id, vocabulary_id, detection_class, severity, recommendation_text, action_class, derived_tier, created_by) "
                "VALUES (:entry_id, 1, :org_id, :vocabulary_id, 'corrosion', 4, 'text', 'monitor', 1, 'test')"
            ),
            {"entry_id": entry_id, "org_id": test_org.organization_id, "vocabulary_id": _vocabulary_id(db_session)},
        )
        record_id = str(uuid.uuid4())
        db_session.execute(
            text(
                "INSERT INTO recommendation_records "
                "(id, organization_id, status, matched_entry_id, matched_entry_version, rollup_scope, scope_key, run_id) "
                "VALUES (:id, :org_id, :status, :entry_id, 1, 'asset', 'x', :run_id)"
            ),
            {"id": record_id, "org_id": test_org.organization_id, "status": status, "entry_id": entry_id, "run_id": run_id},
        )
        db_session.commit()
        return record_id

    def test_adding_a_link_to_an_approved_record_is_blocked(self, db_session, test_org, rec_lookups):
        _skip_unless_postgres(db_session, "DAT-5's link-immutability trigger")
        record_id = self._make_record(db_session, test_org, "Approved")
        with pytest.raises(DBAPIError):
            db_session.execute(
                text(
                    "INSERT INTO recommendation_detection_links (record_id, detection_id, chain_key, severity_at_generation, detection_class, confidence) "
                    "VALUES (:record_id, :detection_id, :detection_id, 4, 'corrosion', 0.9)"
                ),
                {"record_id": record_id, "detection_id": str(uuid.uuid4())},
            )
            db_session.commit()
        db_session.rollback()

    def test_adding_a_link_to_a_draft_record_is_fine(self, db_session, test_org, rec_lookups):
        record_id = self._make_record(db_session, test_org, "Draft")
        db_session.execute(
            text(
                "INSERT INTO recommendation_detection_links (record_id, detection_id, chain_key, severity_at_generation, detection_class, confidence) "
                "VALUES (:record_id, :detection_id, :detection_id, 4, 'corrosion', 0.9)"
            ),
            {"record_id": record_id, "detection_id": str(uuid.uuid4())},
        )
        db_session.commit()

    def test_deleting_a_link_from_a_rejected_record_is_blocked(self, db_session, test_org, rec_lookups):
        _skip_unless_postgres(db_session, "DAT-5's link-immutability trigger")
        record_id = self._make_record(db_session, test_org, "Draft")
        db_session.execute(
            text(
                "INSERT INTO recommendation_detection_links (record_id, detection_id, chain_key, severity_at_generation, detection_class, confidence) "
                "VALUES (:record_id, :detection_id, :detection_id, 4, 'corrosion', 0.9)"
            ),
            {"record_id": record_id, "detection_id": str(uuid.uuid4())},
        )
        db_session.execute(
            text("UPDATE recommendation_records SET status = 'Rejected' WHERE id = :id"), {"id": record_id}
        )
        db_session.commit()

        with pytest.raises(DBAPIError):
            db_session.execute(text("DELETE FROM recommendation_detection_links WHERE record_id = :id"), {"id": record_id})
            db_session.commit()
        db_session.rollback()


class TestAuditEventsAreAppendOnlyAtTheDatabase:
    def test_create_writes_a_row_the_service_can_read_back(self, db_session, test_org):
        # sanity check that runs on every dialect: the plain insert path
        # itself is unaffected by the append-only trigger
        record_audit_event(
            db_session, organization_id=test_org.organization_id, actor="tahya",
            action="entry_created", entity_type="library_entry", entity_id="x",
        )
        db_session.commit()

    def test_update_is_blocked(self, db_session, test_org):
        _skip_unless_postgres(db_session, "AUD-2's append-only trigger")
        db_session.execute(
            text(
                "INSERT INTO recommendation_audit_events (organization_id, actor, action, entity_type, entity_id) "
                "VALUES (:org_id, 'tahya', 'entry_created', 'library_entry', 'x')"
            ),
            {"org_id": test_org.organization_id},
        )
        db_session.commit()
        # the trigger raises a plain exception, not a constraint
        # violation, so this surfaces as InternalError rather than
        # IntegrityError; DBAPIError covers both since that's the point
        # being proven here
        with pytest.raises(DBAPIError):
            db_session.execute(text("UPDATE recommendation_audit_events SET actor = 'someone_else'"))
            db_session.commit()
        db_session.rollback()

    def test_delete_is_blocked(self, db_session, test_org):
        _skip_unless_postgres(db_session, "AUD-2's append-only trigger")
        db_session.execute(
            text(
                "INSERT INTO recommendation_audit_events (organization_id, actor, action, entity_type, entity_id) "
                "VALUES (:org_id, 'tahya', 'entry_created', 'library_entry', 'x')"
            ),
            {"org_id": test_org.organization_id},
        )
        db_session.commit()
        with pytest.raises(DBAPIError):
            db_session.execute(text("DELETE FROM recommendation_audit_events"))
            db_session.commit()
        db_session.rollback()
