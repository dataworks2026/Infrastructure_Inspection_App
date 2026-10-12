"""The actual matching logic. MAT-1, MAT-2, MAT-10.

Given one detection and the current active library, find the single best
entry for it, or nothing if there isn't one. This never looks at an image
or does anything visual -- by the time a detection reaches here it's just
a class string and a severity number. Confidence rides along for a
reviewer to look at later, but it never affects which entry gets picked
(MAT-10): severity is the only thing that's authoritative.

Ported from Tahya's Phase-1 service (app/matching.py), unchanged in
substance. The only difference is the types at the boundary:
``RecommendationLibraryEntry`` (org-scoped, platform ORM model) in place
of her standalone ``LibraryEntry``, and ``MatchableDetection`` in place
of her ``DetectionIn`` -- both expose the same four attributes this
module actually reads (detection_class, severity, asset_id, asset_type),
so the resolution logic itself did not need to change at all.
"""

from typing import Optional

from app.models.recommendation import RecommendationLibraryEntry
from app.services.recommendations.types import MatchableDetection


def find_candidates(
    entries: list[RecommendationLibraryEntry], detection: MatchableDetection
) -> list[RecommendationLibraryEntry]:
    # MAT-2: candidacy requires agreement on normalized class and severity.
    # entries is expected to already be filtered to active + latest.
    return [
        e
        for e in entries
        if e.detection_class == detection.detection_class and e.severity == detection.severity
    ]


def pick_most_specific(
    candidates: list[RecommendationLibraryEntry], detection: MatchableDetection
) -> Optional[RecommendationLibraryEntry]:
    # MAT-2 precedence: asset identifier, then asset type, then unscoped.
    # MAT-3 guarantees at most one active entry per exact rule key, so
    # each tier below can have at most one match.
    for e in candidates:
        if e.asset_id is not None and e.asset_id == detection.asset_id:
            return e
    for e in candidates:
        if e.asset_id is None and e.asset_type is not None and e.asset_type == detection.asset_type:
            return e
    for e in candidates:
        if e.asset_id is None and e.asset_type is None:
            return e
    return None


def resolve_detection(
    entries: list[RecommendationLibraryEntry], detection: MatchableDetection
) -> Optional[RecommendationLibraryEntry]:
    """MAT-1: at most one entry, the most specific active match."""
    candidates = find_candidates(entries, detection)
    return pick_most_specific(candidates, detection)
