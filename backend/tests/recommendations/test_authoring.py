"""LIB-1, LIB-4, LIB-5, LIB-6. Ported from Tahya's Phase-1 service
(tests/test_authoring.py). Her version drove everything through the
HTTP API (asserting status codes and JSON bodies); there is no router
yet (Stage 3), so this calls authoring.py directly and asserts against
the split her own architecture already has -- a malformed EntryWrite
raises a Pydantic ValidationError at construction (blank fields,
out-of-domain severity/tier), while a business rule that needs the
database (vocabulary membership, rule-key collision, archived-entry
edit) raises FieldValidationError/NotFoundError from the service call
itself. Both become a 422/404 once Stage 3 puts a router in front.
"""

import pytest
from pydantic import ValidationError

from app.schemas.recommendation import EntryWrite
from app.services.recommendations import authoring
from app.services.recommendations.errors import FieldValidationError, NotFoundError
from app.services.recommendations.tiers import effective_tier
from tests.recommendations.conftest import entry_write, seed_vocab


class TestCreateEntry:
    def test_create_succeeds_and_normalizes_class(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(
            db_session, test_org.organization_id, entry_write(detection_class="  CORROSION  ")
        )
        assert entry.detection_class == "corrosion"
        assert entry.version == 1
        assert entry.is_active is True
        assert entry.is_latest is True

    def test_derived_tier_matches_oi4_mapping(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4))
        assert entry.derived_tier == 1
        assert effective_tier(entry.derived_tier, entry.tier_override) == 1

    def test_blank_recommendation_text_rejected_with_field_error(self):
        with pytest.raises(ValidationError) as exc_info:
            entry_write(recommendation_text="   ")
        assert any(e["loc"][-1] == "recommendation_text" for e in exc_info.value.errors())

    def test_blank_action_class_rejected(self):
        with pytest.raises(ValidationError):
            entry_write(action_class="")

    def test_missing_detection_class_rejected(self):
        with pytest.raises(ValidationError):
            EntryWrite(
                actor="engineer@example.com",
                severity=3,
                recommendation_text="text",
                action_class="monitor",
            )

    def test_out_of_domain_severity_rejected(self):
        with pytest.raises(ValidationError):
            entry_write(severity=9)

    def test_tier_override_more_urgent_than_derived_is_allowed(self, db_session, test_org, rec_vocab):
        # severity 2 derives tier 3; overriding to tier 1 is more urgent, allowed
        entry = authoring.create_entry(
            db_session, test_org.organization_id, entry_write(severity=2, tier_override=1)
        )
        assert effective_tier(entry.derived_tier, entry.tier_override) == 1

    def test_tier_override_less_urgent_than_derived_is_rejected(self, db_session, test_org, rec_vocab):
        # severity 4 derives tier 1; overriding to tier 3 is less urgent, rejected
        with pytest.raises(FieldValidationError) as exc_info:
            authoring.create_entry(db_session, test_org.organization_id, entry_write(severity=4, tier_override=3))
        assert exc_info.value.field == "tier_override"


class TestClassVocabularyBinding:
    """DAT-1: a rule can only be authored for a class the vocabulary audit
    has actually observed for this organization. See test_dual_enforcement.py
    for the database-level checks this suite doesn't cover.
    """

    def test_creating_an_entry_for_an_unvetted_class_is_rejected(self, db_session, test_org, rec_vocab):
        with pytest.raises(FieldValidationError) as exc_info:
            authoring.create_entry(
                db_session, test_org.organization_id, entry_write(detection_class="titanium fatigue")
            )
        assert exc_info.value.field == "detection_class"

    def test_editing_an_entry_into_an_unvetted_class_is_rejected(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        with pytest.raises(FieldValidationError):
            authoring.edit_entry(
                db_session,
                test_org.organization_id,
                created.entry_id,
                entry_write(detection_class="titanium fatigue"),
            )

    def test_a_known_vocabulary_class_is_accepted(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(
            db_session, test_org.organization_id, entry_write(detection_class="biological growth")
        )
        assert entry.detection_class == "biological growth"

    def test_vocabulary_is_scoped_per_organization(self, db_session, test_org, other_org, rec_lookups):
        # a class vetted for one org is not automatically vetted for another
        seed_vocab(db_session, test_org.organization_id, "corrosion")
        with pytest.raises(FieldValidationError):
            authoring.create_entry(db_session, other_org.organization_id, entry_write())


class TestVersioning:
    def test_edit_creates_a_new_version(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        edited = authoring.edit_entry(
            db_session, test_org.organization_id, created.entry_id,
            entry_write(recommendation_text="Updated wording."),
        )
        assert edited.version == 2
        assert edited.is_latest is True

    def test_old_version_stays_retrievable_but_not_latest(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(
            db_session, test_org.organization_id, entry_write(recommendation_text="Plan a repair.")
        )
        authoring.edit_entry(
            db_session, test_org.organization_id, created.entry_id,
            entry_write(recommendation_text="Updated wording."),
        )

        history = authoring.get_entry_history(db_session, test_org.organization_id, created.entry_id)
        assert len(history) == 2
        v1 = next(v for v in history if v.version == 1)
        assert v1.is_latest is False
        assert v1.recommendation_text == "Plan a repair."

    def test_editing_a_nonexistent_entry_404s(self, db_session, test_org, rec_vocab):
        with pytest.raises(NotFoundError):
            authoring.edit_entry(db_session, test_org.organization_id, "does-not-exist", entry_write())

    def test_editing_an_archived_entry_is_rejected(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.archive_entry(db_session, test_org.organization_id, created.entry_id, "engineer@example.com")

        with pytest.raises(FieldValidationError):
            authoring.edit_entry(db_session, test_org.organization_id, created.entry_id, entry_write())


class TestArchival:
    def test_archive_marks_inactive_and_stamps_archived_at(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        result = authoring.archive_entry(db_session, test_org.organization_id, created.entry_id, "engineer@example.com")
        assert result["versions_archived"] == 1

        history = authoring.get_entry_history(db_session, test_org.organization_id, created.entry_id)
        assert history[0].is_active is False
        assert history[0].archived_at is not None

    def test_archive_covers_every_version(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.edit_entry(
            db_session, test_org.organization_id, created.entry_id, entry_write(recommendation_text="v2 text")
        )

        result = authoring.archive_entry(db_session, test_org.organization_id, created.entry_id, "engineer@example.com")
        assert result["versions_archived"] == 2
        history = authoring.get_entry_history(db_session, test_org.organization_id, created.entry_id)
        assert all(not v.is_active for v in history)

    def test_archived_entry_excluded_from_active_listing(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.archive_entry(db_session, test_org.organization_id, created.entry_id, "engineer@example.com")

        active = authoring.list_entries(db_session, test_org.organization_id, active_only=True)
        assert created.entry_id not in [e.entry_id for e in active]

    def test_archiving_twice_is_a_safe_no_op(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        first = authoring.archive_entry(db_session, test_org.organization_id, created.entry_id, "engineer@example.com")
        second = authoring.archive_entry(db_session, test_org.organization_id, created.entry_id, "engineer@example.com")
        assert first["already_archived"] is False
        assert second["already_archived"] is True


class TestRuleKeyUniqueness:
    """MAT-3: two active entries in the same organization can't share the
    exact same rule key."""

    def test_duplicate_rule_key_rejected(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="cracking", severity=2))
        with pytest.raises(FieldValidationError) as exc_info:
            authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="cracking", severity=2))
        assert exc_info.value.field == "detection_class"

    def test_two_unscoped_entries_still_collide(self, db_session, test_org, rec_vocab):
        # neither entry names an asset_type or asset_id; this is the case
        # a plain unique index would miss, since nulls aren't equal to
        # each other by default (verified against both dialects, see the
        # d8 migration's fix commit)
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="erosion", severity=1))
        with pytest.raises(FieldValidationError):
            authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="erosion", severity=1))

    def test_different_severity_is_not_a_collision(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="spalling", severity=1))
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="spalling", severity=2))
        assert entry.severity == 2

    def test_archiving_frees_up_the_rule_key(self, db_session, test_org, rec_vocab):
        first = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="decay", severity=3))
        authoring.archive_entry(db_session, test_org.organization_id, first.entry_id, "engineer@example.com")
        # the old one is archived now, so the same rule key is fair game again
        second = authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class="decay", severity=3))
        assert second.is_active is True

    def test_editing_an_entry_to_its_own_current_key_is_not_a_false_collision(self, db_session, test_org, rec_vocab):
        created = authoring.create_entry(
            db_session, test_org.organization_id, entry_write(detection_class="biological growth", severity=2)
        )
        edited = authoring.edit_entry(
            db_session, test_org.organization_id, created.entry_id,
            entry_write(detection_class="biological growth", severity=2, recommendation_text="updated wording, same rule key"),
        )
        assert edited.version == 2

    def test_different_organizations_may_use_the_same_rule_key(self, db_session, test_org, other_org, rec_lookups):
        seed_vocab(db_session, test_org.organization_id, "corrosion")
        seed_vocab(db_session, other_org.organization_id, "corrosion")
        authoring.create_entry(db_session, test_org.organization_id, entry_write())
        # same exact key, different org -- must not collide
        entry = authoring.create_entry(db_session, other_org.organization_id, entry_write())
        assert entry.organization_id == other_org.organization_id
