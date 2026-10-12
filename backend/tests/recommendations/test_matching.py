"""Ported from Tahya's Phase-1 service (tests/test_matching.py). Pure
logic against hand-built ORM objects -- no DB round-trip needed, since
matching.py never queries anything itself.
"""

from app.models.recommendation import RecommendationLibraryEntry
from app.services.recommendations.matching import resolve_detection
from tests.recommendations.conftest import make_detection


def entry(**overrides) -> RecommendationLibraryEntry:
    defaults = dict(
        entry_id="e1", version=1, organization_id="org1", vocabulary_id="vocab1",
        is_active=True, is_latest=True,
        detection_class="corrosion", severity=4,
        asset_type=None, asset_id=None,
        recommendation_text="fix it", action_class="structural repair",
        derived_tier=1, created_by="engineer@example.com",
    )
    defaults.update(overrides)
    return RecommendationLibraryEntry(**defaults)


def test_matches_on_class_and_severity():
    e = entry()
    d = make_detection("d1", detection_class="corrosion", severity=4, asset_id=None)
    assert resolve_detection([e], d) is e


def test_class_mismatch_no_match():
    e = entry(detection_class="corrosion")
    d = make_detection("d1", detection_class="cracking", severity=4, asset_id=None)
    assert resolve_detection([e], d) is None


def test_severity_mismatch_no_match():
    e = entry(severity=4)
    d = make_detection("d1", detection_class="corrosion", severity=2, asset_id=None)
    assert resolve_detection([e], d) is None


def test_no_entries_no_match():
    d = make_detection("d1", detection_class="corrosion", severity=4, asset_id=None)
    assert resolve_detection([], d) is None


def test_matching_normalizes_the_same_way_saving_does():
    # both sides are expected to already be normalized by the time they
    # reach matching.py -- entries at save time (authoring.py), detections
    # by the adapter (Stage 2). matching.py itself does exact equality.
    e = entry(detection_class="corrosion")
    d = make_detection("d1", detection_class="corrosion", severity=4, asset_id=None)
    assert resolve_detection([e], d) is e


def test_asset_id_match_wins_over_unscoped():
    unscoped = entry(entry_id="e-unscoped")
    scoped = entry(entry_id="e-scoped", asset_id="asset-42")
    d = make_detection("d1", asset_id="asset-42")
    assert resolve_detection([unscoped, scoped], d) is scoped


def test_asset_type_match_wins_over_unscoped():
    unscoped = entry(entry_id="e-unscoped")
    typed = entry(entry_id="e-typed", asset_type="Coastal")
    d = make_detection("d1", asset_id=None, asset_type="Coastal")
    assert resolve_detection([unscoped, typed], d) is typed


def test_asset_id_match_wins_over_asset_type_match():
    typed = entry(entry_id="e-typed", asset_type="Coastal")
    scoped = entry(entry_id="e-scoped", asset_id="asset-42")
    d = make_detection("d1", asset_id="asset-42", asset_type="Coastal")
    assert resolve_detection([typed, scoped], d) is scoped


def test_asset_id_scoped_entry_does_not_match_a_different_asset_id():
    # the entry is scoped to a specific asset that isn't this detection's
    # -- and unlike an asset_type entry, an asset_id entry never falls
    # back to matching by type or unscoped once it's asset_id-scoped, so
    # this should resolve to no match at all, not a downgraded one.
    scoped_to_other_asset = entry(entry_id="e-scoped", asset_id="asset-other")
    d = make_detection("d1", asset_id="asset-99")
    assert resolve_detection([scoped_to_other_asset], d) is None


def test_falls_through_to_unscoped_when_nothing_more_specific_exists():
    unscoped = entry(entry_id="e-unscoped")
    d = make_detection("d1", asset_id="asset-1", asset_type="Coastal")
    assert resolve_detection([unscoped], d) is unscoped


def test_low_confidence_still_matches_if_severity_matches():
    e = entry(severity=4)
    d = make_detection("d1", severity=4, confidence=0.1, asset_id=None)
    assert resolve_detection([e], d) is e


def test_high_confidence_does_not_matter_if_severity_does_not_match():
    e = entry(severity=4)
    d = make_detection("d1", severity=2, confidence=0.99, asset_id=None)
    assert resolve_detection([e], d) is None
