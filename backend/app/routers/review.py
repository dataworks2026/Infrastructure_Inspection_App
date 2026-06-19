from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.image import Image
from app.models.inspection import Inspection, InspectionStatus
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.schemas.review import (
    ReviewAction,
    SubmitReviewRequest,
    StartReviewResponse,
    SubmitReviewResponse,
    ReviewSummary,
    CompleteReviewResponse,
    DamageTypeAccuracy,
    ReviewDiffResponse,
    OverallReviewStats,
    RecentReviewedInspection,
    ReviewStatsResponse,
    UpdateAssetTypeRequest,
    UpdateAssetTypeResponse,
    ReopenImageReviewResponse,
    ReopenInspectionReviewResponse,
)
from app.services.reports.review_diff import compute_review_diff
from app.services.reports.damage_codes import CODE_LABELS

router = APIRouter()

BBOX_TOLERANCE_PX = 0.5


def _get_org_inspection(inspection_id: str, db: Session, current_user: User) -> Inspection:
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id,
        Inspection.organization_id == current_user.organization_id,
    ).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection


def _bbox_dict(d: Detection) -> dict:
    return {"x1": d.bbox_x1, "y1": d.bbox_y1, "x2": d.bbox_x2, "y2": d.bbox_y2}


def _bbox_changed(old: dict, new: dict) -> bool:
    for key in ("x1", "y1", "x2", "y2"):
        ov, nv = old.get(key), new.get(key)
        if ov is None or nv is None:
            if ov != nv:
                return True
            continue
        if abs(float(ov) - float(nv)) > BBOX_TOLERANCE_PX:
            return True
    return False


def _compute_delta(original: Detection, corrected) -> dict:
    # Server-side field-level diff between the locked CV detection and the
    # engineer's corrected payload. Never trusts client-supplied deltas.
    delta: dict = {}

    old_bbox = _bbox_dict(original)
    new_bbox = corrected.bbox.model_dump()
    if _bbox_changed(old_bbox, new_bbox):
        delta["bbox_changed"] = True
        delta["bbox_before"] = old_bbox
        delta["bbox_after"] = new_bbox
    else:
        delta["bbox_changed"] = False

    # Case-insensitive: CV writes 'Corrosion', the review UI submits 'corrosion'
    old_damage = (original.damage_type or "").strip().lower() or None
    new_damage = (corrected.damage_type or "").strip().lower() or None
    if old_damage != new_damage:
        delta["damage_type_changed"] = True
        delta["damage_type_before"] = original.damage_type
        delta["damage_type_after"] = corrected.damage_type
    else:
        delta["damage_type_changed"] = False

    if (original.severity or None) != (corrected.severity or None):
        delta["severity_changed"] = True
        delta["severity_before"] = original.severity
        delta["severity_after"] = corrected.severity
    else:
        delta["severity_changed"] = False

    # Structural segments (order-insensitive comparison)
    original_meta = original.domain_metadata or {}
    old_segments = original_meta.get("segments", []) or []
    new_segments = corrected.structural_segments or []
    if set(old_segments) != set(new_segments):
        delta["segments_changed"] = True
        delta["segments_before"] = old_segments
        delta["segments_after"] = new_segments
    else:
        delta["segments_changed"] = False

    # Shape type
    old_shape = original.shape_type or "rect"
    new_shape = corrected.shape_type or "rect"
    if old_shape != new_shape:
        delta["shape_changed"] = True
        delta["shape_before"] = old_shape
        delta["shape_after"] = new_shape
    else:
        delta["shape_changed"] = False

    return delta


def _build_domain_metadata(corrected, base: Optional[dict] = None) -> dict:
    """Build the annotation-label domain_metadata dict for an engineer detection.

    Mirrors the Annotation App data model. `base` is the ORIGINAL cv detection's
    domain_metadata (for 'modified' actions) and is used for fallbacks only.
    Keys are included only when meaningful, except "segments" which is always
    present. "segment" (singular, comma-joined) is kept because the digital-twin
    compare page reads domain_metadata.segment.
    """
    base = base or {}
    meta: dict = {}

    code = corrected.damage_code or base.get("code")
    if not code and corrected.damage_type:
        code = corrected.damage_type[:2].upper()
    if code:
        meta["code"] = code

    if corrected.structural_segments is not None:
        segments = list(corrected.structural_segments)
    else:
        segments = list(base.get("segments") or [])
    meta["segments"] = segments
    if segments:
        meta["segment"] = ", ".join(segments)

    defect_id = corrected.defect_id or base.get("defect_id")
    if defect_id:
        meta["defect_id"] = defect_id

    return meta


def _compute_totals(db: Session, inspection_id: str) -> dict:
    image_ids = [row[0] for row in db.query(Image.id).filter(Image.inspection_id == inspection_id).all()]
    total_cv = 0
    if image_ids:
        total_cv = db.query(Detection).filter(
            Detection.image_id.in_(image_ids),
            Detection.source == "cv_model",
            Detection.is_locked.is_(True),
        ).count()

    reviews = db.query(DetectionReview).filter(DetectionReview.inspection_id == inspection_id).all()
    counts = {"accepted": 0, "rejected": 0, "modified": 0, "added": 0}
    for r in reviews:
        if r.action in counts:
            counts[r.action] += 1

    final_count = counts["accepted"] + counts["modified"] + counts["added"]
    accuracy = round((counts["accepted"] + counts["modified"]) / total_cv * 100, 1) if total_cv else 0.0
    return {
        "total_cv_detections": total_cv,
        "accepted": counts["accepted"],
        "rejected": counts["rejected"],
        "modified": counts["modified"],
        "engineer_added": counts["added"],
        "final_verified_count": final_count,
        "cv_accuracy_pct": accuracy,
    }


@router.post("/inspections/{inspection_id}/start-review", response_model=StartReviewResponse)
def start_review(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inspection = _get_org_inspection(inspection_id, db, current_user)

    if inspection.status in (InspectionStatus.pending_review.value, InspectionStatus.review_completed.value):
        raise HTTPException(status_code=409, detail=f"Review already {inspection.status.replace('_', ' ')} for this inspection")

    inspection.status = InspectionStatus.pending_review.value

    image_ids = [row[0] for row in db.query(Image.id).filter(Image.inspection_id == inspection_id).all()]
    locked_count = 0
    if image_ids:
        locked_count = db.query(Detection).filter(
            Detection.image_id.in_(image_ids)
        ).update({Detection.is_locked: True, Detection.source: "cv_model"}, synchronize_session=False)

    db.commit()

    return StartReviewResponse(
        inspection_id=inspection_id,
        status=inspection.status,
        locked_detections_count=locked_count,
    )


@router.post("/images/{image_id}/submit-review", response_model=SubmitReviewResponse)
def submit_image_review(
    image_id: str,
    body: SubmitReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(
        Image.id == image_id,
        Image.organization_id == current_user.organization_id,
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    inspection = db.query(Inspection).filter(Inspection.id == img.inspection_id).first()
    if not inspection or inspection.status != InspectionStatus.pending_review.value:
        raise HTTPException(status_code=409, detail="Inspection is not in pending_review status — call start-review first")

    now = datetime.utcnow()
    counts = {"accepted": 0, "rejected": 0, "modified": 0, "added": 0}

    # Idempotency guard: a CV detection may only be reviewed once
    cv_ids = [item.cv_detection_id for item in body.reviews if item.cv_detection_id]
    if cv_ids:
        existing = db.query(DetectionReview.cv_detection_id).filter(
            DetectionReview.cv_detection_id.in_(cv_ids)
        ).all()
        if existing:
            already = sorted({row[0] for row in existing})
            raise HTTPException(
                status_code=409,
                detail=f"Review already submitted for detection(s): {', '.join(already)}. "
                       "This image appears to have been reviewed already.",
            )
        if len(cv_ids) != len(set(cv_ids)):
            raise HTTPException(status_code=400, detail="Duplicate cv_detection_id in request body")

    def _load_cv_detection(cv_detection_id: str) -> Detection:
        det = db.query(Detection).filter(Detection.id == cv_detection_id).first()
        if not det:
            raise HTTPException(status_code=404, detail=f"Detection {cv_detection_id} not found")
        if det.image_id != image_id:
            raise HTTPException(status_code=400, detail=f"Detection {cv_detection_id} does not belong to image {image_id}")
        return det

    def _mark_reviewed(det: Detection) -> None:
        # Only touch review flags — never the content fields of a locked detection
        det.reviewed = True
        det.reviewed_by = current_user.email
        det.review_date = now

    def _new_engineer_detection(item, infrastructure_type: Optional[str], base_meta: Optional[dict] = None) -> Detection:
        cd = item.corrected_detection
        # Normalize to the CV/YOLO Title-Case convention (CODE_LABELS values)
        # so engineer-added detections match CV detections. Fall back to the
        # raw submitted value when the damage_code is missing/unknown.
        canonical_damage_type = CODE_LABELS.get((cd.damage_code or "").upper()) or cd.damage_type
        return Detection(
            shape_type=cd.shape_type,
            domain_metadata=_build_domain_metadata(cd, base_meta),
            image_id=image_id,
            organization_id=current_user.organization_id,
            infrastructure_type=infrastructure_type,
            damage_type=canonical_damage_type,
            severity=cd.severity,
            bbox_x1=cd.bbox.x1,
            bbox_y1=cd.bbox.y1,
            bbox_x2=cd.bbox.x2,
            bbox_y2=cd.bbox.y2,
            confidence=1.0,
            confidence_score=1.0,
            model_name="engineer_review",
            source="engineer_added",
            is_locked=False,
            reviewed=True,
            reviewed_by=current_user.email,
            review_date=now,
            inspector_notes=item.notes,
        )

    for item in body.reviews:
        if item.action in (ReviewAction.accepted, ReviewAction.rejected):
            original = _load_cv_detection(item.cv_detection_id)
            _mark_reviewed(original)
            db.add(DetectionReview(
                organization_id=current_user.organization_id,
                image_id=image_id,
                inspection_id=img.inspection_id,
                cv_detection_id=original.id,
                engineer_detection_id=None,
                action=item.action.value,
                notes=item.notes,
                reviewed_by=current_user.email,
                reviewed_at=now,
            ))
            counts[item.action.value] += 1

        elif item.action == ReviewAction.modified:
            original = _load_cv_detection(item.cv_detection_id)
            new_det = _new_engineer_detection(item, original.infrastructure_type, original.domain_metadata)
            db.add(new_det)
            db.flush()  # populate new_det.id
            delta = _compute_delta(original, item.corrected_detection)
            _mark_reviewed(original)
            db.add(DetectionReview(
                organization_id=current_user.organization_id,
                image_id=image_id,
                inspection_id=img.inspection_id,
                cv_detection_id=original.id,
                engineer_detection_id=new_det.id,
                action="modified",
                delta_json=delta,
                notes=item.notes,
                reviewed_by=current_user.email,
                reviewed_at=now,
            ))
            counts["modified"] += 1

        else:  # added
            # Copy infrastructure_type from any existing detection on the image, if present
            sibling = db.query(Detection).filter(
                Detection.image_id == image_id,
                Detection.infrastructure_type.isnot(None),
            ).first()
            new_det = _new_engineer_detection(item, sibling.infrastructure_type if sibling else None)
            db.add(new_det)
            db.flush()
            db.add(DetectionReview(
                organization_id=current_user.organization_id,
                image_id=image_id,
                inspection_id=img.inspection_id,
                cv_detection_id=None,
                engineer_detection_id=new_det.id,
                action="added",
                notes=item.notes,
                reviewed_by=current_user.email,
                reviewed_at=now,
            ))
            counts["added"] += 1

    db.commit()

    return SubmitReviewResponse(
        image_id=image_id,
        reviews_written=len(body.reviews),
        cv_accepted=counts["accepted"],
        cv_rejected=counts["rejected"],
        cv_modified=counts["modified"],
        engineer_added=counts["added"],
    )


@router.post("/inspections/{inspection_id}/complete-review", response_model=CompleteReviewResponse)
def complete_review(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inspection = _get_org_inspection(inspection_id, db, current_user)

    if inspection.status != InspectionStatus.pending_review.value:
        raise HTTPException(status_code=409, detail=f"Inspection status is '{inspection.status}' — must be 'pending_review' to complete review")

    # Verify every locked CV detection on this inspection has been reviewed
    image_ids = [row[0] for row in db.query(Image.id).filter(Image.inspection_id == inspection_id).all()]
    if image_ids:
        unreviewed = db.query(Detection).filter(
            Detection.image_id.in_(image_ids),
            Detection.source == "cv_model",
            Detection.is_locked.is_(True),
            Detection.reviewed.is_(False),
        ).count()
        if unreviewed:
            raise HTTPException(
                status_code=409,
                detail=f"{unreviewed} CV detection(s) have not been reviewed yet — submit reviews for all images first",
            )

    inspection.status = InspectionStatus.review_completed.value
    totals = _compute_totals(db, inspection_id)
    db.commit()

    return CompleteReviewResponse(
        inspection_id=inspection_id,
        status=inspection.status,
        summary=ReviewSummary(**totals),
    )


def _reset_image_review(db: Session, image_id: str) -> dict:
    """Discard a prior review pass for one image and reset its CV detections.

    Order matters: detection_reviews has no ondelete on the cv/engineer
    detection FKs, so the review rows must be deleted BEFORE the engineer
    detections they reference. CV detections stay locked/frozen but become
    unreviewed again so the engineer can redo the pass from the CV baseline.
    Returns per-image counts.
    """
    cleared_reviews = db.query(DetectionReview).filter(
        DetectionReview.image_id == image_id
    ).delete(synchronize_session=False)

    removed_engineer = db.query(Detection).filter(
        Detection.image_id == image_id,
        Detection.source == "engineer_added",
    ).delete(synchronize_session=False)

    reset_cv = db.query(Detection).filter(
        Detection.image_id == image_id,
        Detection.source == "cv_model",
    ).update(
        {
            Detection.reviewed: False,
            Detection.reviewed_by: None,
            Detection.review_date: None,
        },
        synchronize_session=False,
    )

    return {
        "cleared_reviews": cleared_reviews,
        "removed_engineer_detections": removed_engineer,
        "reset_cv_detections": reset_cv,
    }


@router.post("/images/{image_id}/reopen-review", response_model=ReopenImageReviewResponse)
def reopen_image_review(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(
        Image.id == image_id,
        Image.organization_id == current_user.organization_id,
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    inspection = db.query(Inspection).filter(Inspection.id == img.inspection_id).first()
    if not inspection or inspection.status not in (
        InspectionStatus.pending_review.value,
        InspectionStatus.review_completed.value,
    ):
        raise HTTPException(
            status_code=409,
            detail="Inspection must be in 'pending_review' or 'review_completed' status to reopen an image review",
        )

    counts = _reset_image_review(db, image_id)

    # An image is now unreviewed — a completed inspection drops back to pending
    if inspection.status == InspectionStatus.review_completed.value:
        inspection.status = InspectionStatus.pending_review.value

    db.commit()

    return ReopenImageReviewResponse(
        image_id=image_id,
        inspection_id=img.inspection_id,
        status=inspection.status,
        **counts,
    )


@router.post("/inspections/{inspection_id}/reopen-review", response_model=ReopenInspectionReviewResponse)
def reopen_inspection_review(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inspection = _get_org_inspection(inspection_id, db, current_user)

    if inspection.status not in (
        InspectionStatus.review_completed.value,
        InspectionStatus.pending_review.value,
    ):
        raise HTTPException(
            status_code=409,
            detail="Inspection must be in 'review_completed' or 'pending_review' status to reopen its review",
        )

    image_ids = [row[0] for row in db.query(Image.id).filter(Image.inspection_id == inspection_id).all()]
    totals = {"cleared_reviews": 0, "removed_engineer_detections": 0, "reset_cv_detections": 0}
    for image_id in image_ids:
        counts = _reset_image_review(db, image_id)
        for k in totals:
            totals[k] += counts[k]

    inspection.status = InspectionStatus.pending_review.value
    db.commit()

    return ReopenInspectionReviewResponse(
        inspection_id=inspection_id,
        status=InspectionStatus.pending_review.value,
        **totals,
    )


@router.get("/review-stats", response_model=ReviewStatsResponse)
def get_review_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Org-wide CV accuracy stats aggregated from engineer review data.
    # NOTE: deliberately NOT /inspections/review-stats — the inspections
    # router registers GET /inspections/{inspection_id} before this router
    # in main.py, which would shadow that path ("review-stats" would be
    # captured as an inspection_id).
    org_id = current_user.organization_id

    inspections: List[Inspection] = db.query(Inspection).filter(
        Inspection.organization_id == org_id,
        Inspection.status == InspectionStatus.review_completed.value,
    ).all()
    inspection_ids = [i.id for i in inspections]

    if not inspection_ids:
        return ReviewStatsResponse(
            overall=OverallReviewStats(
                reviewed_inspections=0,
                total_cv_detections=0,
                accepted=0,
                rejected=0,
                modified=0,
                engineer_added=0,
                avg_accuracy_pct=0.0,
            ),
            by_damage_type={},
            recent=[],
        )

    # Locked CV detections of those inspections (one query, joined via Image)
    cv_rows = db.query(Detection.id, Detection.damage_type, Image.inspection_id).join(
        Image, Detection.image_id == Image.id
    ).filter(
        Image.inspection_id.in_(inspection_ids),
        Detection.source == "cv_model",
        Detection.is_locked.is_(True),
    ).all()
    cv_damage_type_by_id: Dict[str, str] = {row[0]: (row[1] or "unknown") for row in cv_rows}

    reviews: List[DetectionReview] = db.query(DetectionReview).filter(
        DetectionReview.organization_id == org_id,
        DetectionReview.inspection_id.in_(inspection_ids),
    ).all()

    # ── overall (pooled across the org, not mean-of-means) ───────────────────
    counts = {"accepted": 0, "rejected": 0, "modified": 0, "added": 0}
    for r in reviews:
        if r.action in counts:
            counts[r.action] += 1
    total_cv = len(cv_rows)
    avg_accuracy = round((counts["accepted"] + counts["modified"]) / total_cv * 100, 1) if total_cv else 0.0

    # ── by damage type (keyed by ORIGINAL CV detection damage_type) ──────────
    dmg: Dict[str, Dict[str, int]] = {}
    for det_id, damage_type, _insp_id in cv_rows:
        key = damage_type or "unknown"
        dmg.setdefault(key, {"cv": 0, "accepted": 0, "rejected": 0, "modified": 0})
        dmg[key]["cv"] += 1
    for r in reviews:
        if r.action in ("accepted", "rejected", "modified") and r.cv_detection_id:
            key = cv_damage_type_by_id.get(r.cv_detection_id)
            if key is None:
                continue
            dmg.setdefault(key, {"cv": 0, "accepted": 0, "rejected": 0, "modified": 0})
            dmg[key][r.action] += 1

    by_damage_type: Dict[str, DamageTypeAccuracy] = {}
    for key, c in dmg.items():
        pct = round((c["accepted"] + c["modified"]) / c["cv"] * 100, 1) if c["cv"] else 0.0
        by_damage_type[key] = DamageTypeAccuracy(
            cv=c["cv"], accepted=c["accepted"], rejected=c["rejected"], modified=c["modified"], pct=pct,
        )

    # ── recent (last 10 review_completed inspections, newest first) ──────────
    cv_count_by_inspection: Dict[str, int] = {}
    for _det_id, _damage_type, insp_id in cv_rows:
        cv_count_by_inspection[insp_id] = cv_count_by_inspection.get(insp_id, 0) + 1

    correct_by_inspection: Dict[str, int] = {}
    latest_review_at: Dict[str, datetime] = {}
    for r in reviews:
        if r.action in ("accepted", "modified"):
            correct_by_inspection[r.inspection_id] = correct_by_inspection.get(r.inspection_id, 0) + 1
        if r.reviewed_at is not None:
            prev = latest_review_at.get(r.inspection_id)
            if prev is None or r.reviewed_at > prev:
                latest_review_at[r.inspection_id] = r.reviewed_at

    def _sort_key(insp: Inspection):
        return latest_review_at.get(insp.id) or insp.updated_at or insp.created_at or datetime.min

    recent: List[RecentReviewedInspection] = []
    for insp in sorted(inspections, key=_sort_key, reverse=True)[:10]:
        insp_cv = cv_count_by_inspection.get(insp.id, 0)
        insp_correct = correct_by_inspection.get(insp.id, 0)
        recent.append(RecentReviewedInspection(
            inspection_id=insp.id,
            name=insp.name,
            reviewed_at=latest_review_at.get(insp.id),
            accuracy_pct=round(insp_correct / insp_cv * 100, 1) if insp_cv else 0.0,
            cv_detections=insp_cv,
        ))

    return ReviewStatsResponse(
        overall=OverallReviewStats(
            reviewed_inspections=len(inspection_ids),
            total_cv_detections=total_cv,
            accepted=counts["accepted"],
            rejected=counts["rejected"],
            modified=counts["modified"],
            engineer_added=counts["added"],
            avg_accuracy_pct=avg_accuracy,
        ),
        by_damage_type=by_damage_type,
        recent=recent,
    )


@router.get("/inspections/{inspection_id}/review-diff", response_model=ReviewDiffResponse)
def get_review_diff(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Org scoping happens here — compute_review_diff itself queries by
    # inspection_id only.
    _get_org_inspection(inspection_id, db, current_user)
    return ReviewDiffResponse(**compute_review_diff(db, inspection_id))


@router.patch("/images/{image_id}/asset-type", response_model=UpdateAssetTypeResponse)
def update_image_asset_type(
    image_id: str,
    body: UpdateAssetTypeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Image metadata update, mirrors the annotation app's instant PATCH.
    # Allowed regardless of inspection status.
    img = db.query(Image).filter(
        Image.id == image_id,
        Image.organization_id == current_user.organization_id,
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    # SQLAlchemy JSON columns don't detect in-place mutation — assign a NEW dict
    img.domain_metadata = {**(img.domain_metadata or {}), "asset_type": body.asset_type}
    db.commit()

    return UpdateAssetTypeResponse(image_id=image_id, asset_type=body.asset_type)
