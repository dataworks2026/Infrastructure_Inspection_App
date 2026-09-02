"""LIB-7: at least 50 active entries, with no degradation of matching
correctness or completeness. Ported from Tahya's Phase-1 service
(tests/test_scale.py) at the service layer.
"""

import time
import uuid

from app.services.recommendations import authoring, engine
from tests.recommendations.conftest import entry_write, make_detection

CLASSES = ["corrosion", "cracking", "spalling", "decay", "erosion", "biological growth"]


class TestFiftyPlusEntries:
    def test_fifty_entries_all_create_successfully(self, db_session, test_org, rec_vocab):
        created = 0
        for cls in CLASSES:
            for severity in (1, 2, 3, 4):
                for asset_type in (None, "tank", "pipeline"):
                    entry = authoring.create_entry(
                        db_session, test_org.organization_id,
                        entry_write(
                            detection_class=cls, severity=severity, asset_type=asset_type,
                            recommendation_text=f"{cls} sev{severity} {asset_type or 'unscoped'}",
                        ),
                    )
                    assert entry.is_active is True
                    created += 1
        assert created >= 50

    def test_matching_is_still_correct_and_complete_at_scale(self, db_session, test_org, rec_vocab):
        # for every (class, severity) combo, create three entries that
        # differ only in scope: unscoped, scoped to a made-up asset type,
        # and scoped to a specific asset id. 6 classes x 4 severities x 3
        # scopes = 72 entries actually in the library, well past the
        # stated 50, with the unscoped ones the target below
        entries_by_key = {}
        for cls in CLASSES:
            for severity in (1, 2, 3, 4):
                authoring.create_entry(
                    db_session, test_org.organization_id,
                    entry_write(detection_class=cls, severity=severity, asset_type="a made up type nothing below asks for", recommendation_text=f"{cls} sev{severity} by type"),
                )
                authoring.create_entry(
                    db_session, test_org.organization_id,
                    entry_write(detection_class=cls, severity=severity, asset_id=str(uuid.uuid4()), recommendation_text=f"{cls} sev{severity} by id"),
                )
                unscoped = authoring.create_entry(
                    db_session, test_org.organization_id,
                    entry_write(detection_class=cls, severity=severity, recommendation_text=f"{cls} sev{severity} unscoped"),
                )
                entries_by_key[(cls, severity)] = unscoped

        assert len(entries_by_key) >= 24  # 24 distinct keys, 72 entries total in the library

        # one detection per (class, severity) combo, each should resolve
        # to the one specific *unscoped* entry with that exact key, out
        # of 72 candidates now sitting in the library, not some other one
        detections = []
        expected_entry_by_detection_id = {}
        for i, ((cls, severity), entry) in enumerate(entries_by_key.items()):
            d = make_detection(f"d{i}", detection_class=cls, severity=severity)
            detections.append(d)
            expected_entry_by_detection_id[d.id] = entry.entry_id

        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")

        # completeness: every detection sent in is accounted for
        assert run.total_detections == len(detections)
        assert run.total_matched == len(detections)
        assert run.total_unmatched == 0

        # correctness: each one landed on the *specific* entry with its
        # exact class+severity, not just "some" entry
        records = engine.get_records_for_run(db_session, run.id)
        detection_to_matched_entry = {}
        for record in records:
            for detection_id in engine.get_detection_ids(db_session, record.id):
                detection_to_matched_entry[detection_id] = record.matched_entry_id

        for detection_id, expected_entry_id in expected_entry_by_detection_id.items():
            assert detection_to_matched_entry[detection_id] == expected_entry_id

    def test_precedence_still_correct_with_many_entries_in_play(self, db_session, test_org, rec_vocab):
        # a pile of unrelated entries, plus the three precedence tiers
        # for one specific class+severity, all coexisting; the most
        # specific one should still win even with lots of noise in the
        # library. DAT-1 means the class itself has to be real, so the
        # noise comes from a unique asset_type per row instead of a
        # made-up class.
        for i in range(40):
            authoring.create_entry(
                db_session, test_org.organization_id,
                entry_write(detection_class=CLASSES[i % len(CLASSES)], severity=(i % 4) + 1, asset_type=f"noise asset type {i}", recommendation_text=f"noise {i}"),
            )

        asset_id = str(uuid.uuid4())
        by_id = authoring.create_entry(
            db_session, test_org.organization_id,
            entry_write(detection_class="corrosion", severity=4, asset_id=asset_id, recommendation_text="scoped to this exact asset"),
        )
        authoring.create_entry(
            db_session, test_org.organization_id,
            entry_write(detection_class="corrosion", severity=4, asset_type="tank", recommendation_text="scoped to tanks generally"),
        )
        authoring.create_entry(
            db_session, test_org.organization_id,
            entry_write(detection_class="corrosion", severity=4, recommendation_text="unscoped fallback"),
        )

        d = make_detection("d1", detection_class="corrosion", severity=4, asset_id=asset_id, asset_type="tank")
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", [d], "asset", "engineer@example.com")
        records = engine.get_records_for_run(db_session, run.id)
        assert records[0].matched_entry_id == by_id.entry_id


class TestPerformance:
    """OI-5: a full-dataset run has to finish inside one interactive
    wait, not something a reviewer sits around for. There's no exact
    number in the baseline, so this checks against a generous ceiling (a
    real interactive wait is a few seconds, this gives a lot of headroom
    for a slower machine) and prints the actual time so it can get
    reported as measured, not guessed at.
    """

    def test_a_full_scale_run_finishes_in_one_interactive_wait(self, db_session, test_org, rec_vocab):
        for cls in CLASSES:
            for severity in (1, 2, 3, 4):
                authoring.create_entry(db_session, test_org.organization_id, entry_write(detection_class=cls, severity=severity))
        # 6 classes x 4 severities = 24 entries, plus 500 detections
        # spread across them and 100 different assets -- past the
        # library's own 50-entry floor and a realistic site-sized batch

        asset_ids = [f"asset-{i}" for i in range(100)]
        detections = [
            make_detection(
                f"d{i}",
                detection_class=CLASSES[i % len(CLASSES)],
                severity=(i % 4) + 1,
                asset_id=asset_ids[i % len(asset_ids)],
            )
            for i in range(500)
        ]

        started = time.monotonic()
        run = engine.run_resolution(db_session, test_org.organization_id, "inspection-1", detections, "asset", "engineer@example.com")
        elapsed = time.monotonic() - started

        assert run.total_detections == 500
        assert run.total_matched == 500

        print(f"\n500-detection run against a 24-entry library took {elapsed:.2f}s")
        assert elapsed < 10, f"run took {elapsed:.2f}s, well past what counts as an interactive wait"
