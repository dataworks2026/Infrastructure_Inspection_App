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
    ReviewTotals,
    PerImageAction,
    PerImageDiff,
    DamageTypeAccuracy,
    ModificationEntry,
    ReviewDiffResponse,
)

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

    if (original.damage_type or None) != (corrected.damage_type or None):
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

    return delta


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

    def _new_engineer_detection(item, infrastructure_type: Optional[str]) -> Detection:
        cd = item.corrected_detection
        return Detection(
            image_id=image_id,
            organization_id=current_user.organization_id,
            infrastructure_type=infrastructure_type,
            damage_type=cd.damage_type,
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
            new_det = _new_engineer_detection(item, original.infrastructure_type)
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


@router.get("/inspections/{inspection_id}/review-diff", response_model=ReviewDiffResponse)
def get_review_diff(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inspection = _get_org_inspection(inspection_id, db, current_user)

    images = db.query(Image).filter(Image.inspection_id == inspection_id).all()
    images_by_id: Dict[str, Image] = {i.id: i for i in images}
    image_ids = list(images_by_id.keys())

    cv_detections: List[Detection] = []
    if image_ids:
        cv_detections = db.query(Detection).filter(
            Detection.image_id.in_(image_ids),
            Detection.source == "cv_model",
            Detection.is_locked.is_(True),
        ).all()
    cv_by_id: Dict[str, Detection] = {d.id: d for d in cv_detections}

    reviews: List[DetectionReview] = db.query(DetectionReview).filter(
        DetectionReview.inspection_id == inspection_id
    ).all()

    # ── totals ────────────────────────────────────────────────────────────────
    counts = {"accepted": 0, "rejected": 0, "modified": 0, "added": 0}
    for r in reviews:
        if r.action in counts:
            counts[r.action] += 1
    total_cv = len(cv_detections)
    final_count = counts["accepted"] + counts["modified"] + counts["added"]
    accuracy = round((counts["accepted"] + counts["modified"]) / total_cv * 100, 1) if total_cv else 0.0

    # ── latest reviewer ───────────────────────────────────────────────────────
    reviewed_by = None
    reviewed_at = None
    dated_reviews = [r for r in reviews if r.reviewed_at is not None]
    if dated_reviews:
        latest = max(dated_reviews, key=lambda r: r.reviewed_at)
        reviewed_by, reviewed_at = latest.reviewed_by, latest.reviewed_at
    elif reviews:
        reviewed_by = reviews[-1].reviewed_by

    # ── per-image ─────────────────────────────────────────────────────────────
    cv_count_by_image: Dict[str, int] = {}
    for d in cv_detections:
        cv_count_by_image[d.image_id] = cv_count_by_image.get(d.image_id, 0) + 1

    reviews_by_image: Dict[str, List[DetectionReview]] = {}
    for r in reviews:
        reviews_by_image.setdefault(r.image_id, []).append(r)

    per_image: List[PerImageDiff] = []
    for img_id, img_reviews in reviews_by_image.items():
        img = images_by_id.get(img_id)
        cv_count = cv_count_by_image.get(img_id, 0)
        img_accepted = sum(1 for r in img_reviews if r.action == "accepted")
        img_modified = sum(1 for r in img_reviews if r.action == "modified")
        img_added = sum(1 for r in img_reviews if r.action == "added")
        img_final = img_accepted + img_modified + img_added
        img_pct = round((img_accepted + img_modified) / cv_count * 100, 1) if cv_count else 0.0
        per_image.append(PerImageDiff(
            image_id=img_id,
            filename=img.filename if img else "",
            cv_count=cv_count,
            final_count=img_final,
            accuracy_pct=img_pct,
            actions=[PerImageAction(
                cv_detection_id=r.cv_detection_id,
                engineer_detection_id=r.engineer_detection_id,
                action=r.action,
                notes=r.notes,
            ) for r in img_reviews],
        ))

    # ── damage-type accuracy (keyed by ORIGINAL CV damage_type) ───────────────
    dmg: Dict[str, Dict[str, int]] = {}
    for d in cv_detections:
        key = d.damage_type or "unknown"
        dmg.setdefault(key, {"cv": 0, "accepted": 0, "rejected": 0, "modified": 0})
        dmg[key]["cv"] += 1
    for r in reviews:
        if r.action in ("accepted", "rejected", "modified") and r.cv_detection_id:
            original = cv_by_id.get(r.cv_detection_id)
            if original is None:
                continue
            key = original.damage_type or "unknown"
            dmg.setdefault(key, {"cv": 0, "accepted": 0, "rejected": 0, "modified": 0})
            dmg[key][r.action] += 1

    damage_type_accuracy: Dict[str, DamageTypeAccuracy] = {}
    for key, c in dmg.items():
        pct = round((c["accepted"] + c["modified"]) / c["cv"] * 100, 1) if c["cv"] else 0.0
        damage_type_accuracy[key] = DamageTypeAccuracy(
            cv=c["cv"], accepted=c["accepted"], rejected=c["rejected"], modified=c["modified"], pct=pct,
        )

    # ── modification log ──────────────────────────────────────────────────────
    modifications = [
        ModificationEntry(
            cv_detection_id=r.cv_detection_id,
            image_filename=images_by_id[r.image_id].filename if r.image_id in images_by_id else None,
            delta=r.delta_json,
            notes=r.notes,
        )
        for r in reviews if r.action == "modified"
    ]

    return ReviewDiffResponse(
        inspection_id=inspection_id,
        reviewed_by=reviewed_by,
        reviewed_at=reviewed_at,
        totals=ReviewTotals(
            cv_detections=total_cv,
            accepted=counts["accepted"],
            rejected=counts["rejected"],
            modified=counts["modified"],
            engineer_added=counts["added"],
            final_count=final_count,
            accuracy_pct=accuracy,
        ),
        per_image=per_image,
        damage_type_accuracy=damage_type_accuracy,
        modifications=modifications,
    )
