"""The internal detection representation the engine matches against.

Tahya's Phase-1 service took a Pydantic ``DetectionIn`` straight off an
uploaded JSON export (platform §8: a ``class``/``severity`` pair per
detection, plus an ``asset_type`` testing seam and a synthetic
``dismissed`` boolean that never existed on the real platform). That
ingestion boundary is deleted entirely in the port -- there is no file
upload, and detections are never POSTed. In its place, this module
defines the shape ``detection_feed.py`` (Stage 2) produces once it reads
the platform's own ``detections`` + ``detection_reviews`` tables.

Two fields are new here and did not exist in Tahya's version, both
required by baseline §8.3 (Revision B):

- ``chain_key``: the stable identity a severity correction preserves --
  the CV-origin detection id for a chain descended from a CV detection,
  or the detection's own id for a pure engineer-added finding. This is
  what MAT-11 supersede compares across a rerun, decoupled from ``id``
  (which is the row actually consumed -- the engineer row for a
  ``modified``/``added`` review, the CV row for ``accepted`` -- and can
  legitimately differ from the chain's identity).
- ``skip_reason``: set when the detection could not be resolved into a
  matchable severity/scope at all (null or out-of-domain severity,
  unscopable). Skipped detections are excluded from matching exactly
  like ``dismissed`` ones, but counted separately (Reconciliation 3):
  matched + unmatched + dismissed + skipped = rows consumed. Never
  silently dropped -- MAT-6's escalate-don't-patch posture, extended.

Matching itself is untouched: candidacy is still exact equality on
(detection_class, severity), unaware that severity started out as a
platform string -- the S1-S4 -> 1-4 map happens once, at the boundary
into this object, per baseline §8.3.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class MatchableDetection:
    id: str
    chain_key: str

    detection_class: str
    severity: int  # already mapped to 1-4 by the caller (baseline §8.3)
    confidence: float

    image_id: Optional[str] = None
    asset_id: Optional[str] = None
    asset_type: Optional[str] = None
    inspection_id: Optional[str] = None

    location: Optional[dict] = None  # {"lat": ..., "lng": ..., "alt": ...} or None

    dismissed: bool = False
    skip_reason: Optional[str] = None  # None = eligible for matching
