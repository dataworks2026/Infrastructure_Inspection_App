"""AUD-1 through AUD-4. Ported from Tahya's Phase-1 service
(tests/test_audit.py). Her version drove everything through the HTTP
API; this calls authoring.py + audit.list_audit_events directly against
the same in-memory schema (see audit.py's list_audit_events docstring
for why the query function lives there now rather than in a router).
"""

from app.services.recommendations import authoring
from app.services.recommendations.audit import list_audit_events
from tests.recommendations.conftest import entry_write


class TestAuditCoverage:
    def test_create_writes_one_event(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write(actor="tahya@example.com"))
        events = list_audit_events(db_session, test_org.organization_id, entity_id=entry.entry_id)
        assert len(events) == 1
        assert events[0].action == "entry_created"
        assert events[0].actor == "tahya@example.com"
        assert events[0].entity_version == 1

    def test_edit_writes_a_versioned_event(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.edit_entry(db_session, test_org.organization_id, entry.entry_id, entry_write(recommendation_text="v2"))

        events = list_audit_events(db_session, test_org.organization_id, entity_id=entry.entry_id)
        assert len(events) == 2
        versioned = next(e for e in events if e.action == "entry_versioned")
        assert versioned.entity_version == 2
        assert versioned.detail["previous_version"] == 1

    def test_archive_writes_one_event_even_though_it_touches_every_version(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.edit_entry(db_session, test_org.organization_id, entry.entry_id, entry_write(recommendation_text="v2"))
        authoring.archive_entry(db_session, test_org.organization_id, entry.entry_id, "engineer@example.com")

        events = list_audit_events(db_session, test_org.organization_id, entity_id=entry.entry_id)
        archive_events = [e for e in events if e.action == "entry_archived"]
        assert len(archive_events) == 1
        assert archive_events[0].detail["versions_archived"] == 2

    def test_double_archive_does_not_duplicate_the_event(self, db_session, test_org, rec_vocab):
        entry = authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.archive_entry(db_session, test_org.organization_id, entry.entry_id, "engineer@example.com")
        authoring.archive_entry(db_session, test_org.organization_id, entry.entry_id, "engineer@example.com")

        events = list_audit_events(db_session, test_org.organization_id, entity_id=entry.entry_id)
        archive_events = [e for e in events if e.action == "entry_archived"]
        assert len(archive_events) == 1


class TestAuditFiltering:
    def test_filter_by_actor(self, db_session, test_org, rec_vocab):
        authoring.create_entry(db_session, test_org.organization_id, entry_write(actor="tahya@example.com", detection_class="corrosion"))
        authoring.create_entry(db_session, test_org.organization_id, entry_write(actor="other@example.com", detection_class="cracking"))

        tahya_events = list_audit_events(db_session, test_org.organization_id, actor="tahya@example.com")
        assert len(tahya_events) == 1
        assert all(e.actor == "tahya@example.com" for e in tahya_events)

    def test_filter_by_date_range_excludes_events_outside_it(self, db_session, test_org, rec_vocab):
        from datetime import datetime, timezone

        authoring.create_entry(db_session, test_org.organization_id, entry_write())
        far_future_start = datetime(2099, 1, 1, tzinfo=timezone.utc)
        events = list_audit_events(db_session, test_org.organization_id, start=far_future_start)
        assert events == []

    def test_events_are_ordered_stably(self, db_session, test_org, rec_vocab):
        classes = ["corrosion", "cracking", "spalling", "decay", "erosion"]
        for i, cls in enumerate(classes):
            authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class=cls, recommendation_text=f"entry {i}"))
        events = list_audit_events(db_session, test_org.organization_id)
        ids = [e.id for e in events]
        assert ids == sorted(ids)

    def test_events_are_scoped_to_the_organization(self, db_session, test_org, other_org, rec_lookups):
        from tests.recommendations.conftest import seed_vocab

        seed_vocab(db_session, test_org.organization_id, "corrosion")
        seed_vocab(db_session, other_org.organization_id, "corrosion")
        authoring.create_entry(db_session, test_org.organization_id, entry_write())
        authoring.create_entry(db_session, other_org.organization_id, entry_write())

        events = list_audit_events(db_session, test_org.organization_id)
        assert len(events) == 1
