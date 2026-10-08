"""Stage 2 adapter: the platform's reviewed findings, as the engine wants them.

Baseline Rev B section 8.3, the adapter contract. The engine never reads
files or posted exports; this module reads detections, detection_reviews,
images, inspections and assets in-process, read only, and hands the
engine a list of MatchableDetection.

Effective detection set for an inspection:
  accepted CV rows pass through as they are;
  a modified verdict is represented by the engineer's corrected row, keyed
    on the original cv_detection_id (the chain key), so a severity
    correction reads as the same chain with a new severity;
  an added verdict is the engineer row under its own id;
  rejected CV rows are excluded from matching as dismissed, but counted;
  a CV row replaced by a modification is not consumed twice.

Severity 'S1'..'S4' maps to 1..4 at this boundary. 'S0', NULL and anything
else is out of domain: the row is skipped with its raw value in the reason
and counted (Reconciliation 3). A class outside the signed vocabulary is
skipped the same way (DAT-1). Classes are normalized here exactly the way
authoring normalizes them, so matching is exact equality on both sides.
"""
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection, InspectionStatus
from app.models.recommendation import RecommendationClassVocabulary
from app.services.recommendations.authoring import resolve_vocabulary
from app.services.recommendations.types import MatchableDetection

SEVERITY_TO_INT = {"S1": 1, "S2": 2, "S3": 3, "S4": 4}
REVIEWED_STATES = (InspectionStatus.review_completed.value,)


class ReviewNotCompleted(Exception):
    """The engineer gate: the engine only looks at reviewed findings."""


def normalize_class(value: Optional[str]) -> str:
    v = unicodedata.normalize("NFKC", value or "").strip().lower()
    v = re.sub(r"[‐-―\-]+", " ", v)
    return re.sub(r"\s+", " ", v).strip()


def signed_classes(db: Session, producer: str) -> set[str]:
    vocab = resolve_vocabulary(db, producer)
    rows = db.execute(
        select(RecommendationClassVocabulary.class_value)
        .where(RecommendationClassVocabulary.vocabulary_id == vocab.id)
    ).scalars().all()
    return set(rows)


@dataclass
class FeedSummary:
    inspection_id: str
    inspection_status: str
    detections_read: int
    consumed: int
    replaced_by_modification: int


def load_matchable_detections(
    db: Session,
    organization_id: str,
    inspection_id: str,
    vocabulary: set[str],
    *,
    require_review: bool = True,
) -> tuple[list[MatchableDetection], FeedSummary]:
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id, Inspection.organization_id == organization_id
    ).first()
    if inspection is None:
        raise LookupError(f"Inspection {inspection_id!r} not found in this organization")
    if require_review and inspection.status not in REVIEWED_STATES:
        raise ReviewNotCompleted(
            f"inspection {inspection_id!r} is '{inspection.status}'; the engine only runs on a completed review"
        )

    asset = db.query(Asset).filter(Asset.id == inspection.asset_id).first()
    asset_type = asset.infrastructure_type if asset else None
    asset_id = inspection.asset_id
    images = {i.id: i for i in db.query(Image).filter(Image.inspection_id == inspection_id, Image.deleted_at.is_(None)).all()}
    detections = db.query(Detection).filter(Detection.image_id.in_(images.keys())).all() if images else []
    reviews = db.query(DetectionReview).filter(DetectionReview.inspection_id == inspection_id).all()

    # latest verdict per CV row and per engineer row; reviewed_at orders multi-hop chains
    def _ts(r):
        return (r.reviewed_at or r.created_at) or 0
    cv_verdict: dict[str, DetectionReview] = {}
    eng_verdict: dict[str, DetectionReview] = {}
    for r in sorted(reviews, key=_ts):
        if r.cv_detection_id:
            cv_verdict[r.cv_detection_id] = r
        if r.engineer_detection_id:
            eng_verdict[r.engineer_detection_id] = r

    out: list[MatchableDetection] = []
    replaced = 0
    for d in detections:
        if d.source == "engineer_added":
            verdict = eng_verdict.get(d.id)
            if verdict is not None and verdict.action == "modified" and verdict.cv_detection_id:
                chain_key = verdict.cv_detection_id
            else:
                chain_key = d.id
            # an engineer row that was itself corrected later is replaced by its successor
            later = cv_verdict.get(d.id)
            if later is not None and later.action == "modified":
                replaced += 1
                continue
            dismissed = bool(later is not None and later.action == "rejected")
        else:
            verdict = cv_verdict.get(d.id)
            if verdict is None:
                if require_review:
                    # cannot happen on a completed review (completion requires every locked
                    # CV row reviewed); listed, not dropped, if it does
                    out.append(_matchable(d, d.id, asset_id, asset_type, images, vocabulary,
                                          skip_reason="not reviewed"))
                    continue
                chain_key, dismissed = d.id, False
            elif verdict.action == "modified":
                replaced += 1
                continue
            elif verdict.action == "rejected":
                chain_key, dismissed = d.id, True
            else:  # accepted
                chain_key, dismissed = d.id, False
        out.append(_matchable(d, chain_key, asset_id, asset_type, images, vocabulary, dismissed=dismissed))

    summary = FeedSummary(
        inspection_id=inspection_id, inspection_status=inspection.status,
        detections_read=len(detections), consumed=len(out), replaced_by_modification=replaced,
    )
    return out, summary


def _matchable(
    d: Detection, chain_key: str, asset_id: Optional[str], asset_type: Optional[str], images: dict, vocabulary: set[str],
    *, dismissed: bool = False, skip_reason: Optional[str] = None,
) -> MatchableDetection:
    cls = normalize_class(d.damage_type)
    severity = SEVERITY_TO_INT.get(d.severity or "", 0)
    reason = skip_reason
    if reason is None and severity == 0:
        reason = f"severity out of domain: {d.severity!r}"
    if reason is None and cls not in vocabulary:
        reason = f"unvetted class: {d.damage_type!r}"
    img = images.get(d.image_id)
    location = None
    if img is not None and img.gps_lat is not None and img.gps_lon is not None:
        location = {"lat": img.gps_lat, "lng": img.gps_lon, "alt": img.altitude_agl_m}
    confidence = d.confidence_score if d.confidence_score is not None else d.confidence
    return MatchableDetection(
        id=d.id, chain_key=chain_key, detection_class=cls, severity=severity,
        confidence=float(confidence or 0.0), image_id=d.image_id,
        asset_id=asset_id,
        asset_type=asset_type, inspection_id=img.inspection_id if img is not None else None,
        location=location, dismissed=dismissed, skip_reason=reason,
    )

