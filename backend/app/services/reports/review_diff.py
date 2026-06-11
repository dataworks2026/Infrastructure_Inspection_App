"""Shared aggregation for the engineer review diff.

Used by both the GET /inspections/{id}/review-diff endpoint and the PDF
report's "Engineer Review" section. Returns plain dicts shaped exactly like
ReviewDiffResponse so the router can validate them straight into the schema.

NOTE: callers are responsible for org-scoping the inspection BEFORE calling
this function — it queries by inspection_id only.
"""
from typing import Dict, List

from sqlalchemy.orm import Session

from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image


def has_review_data(db: Session, inspection_id: str) -> bool:
    """Cheap existence check — True when any DetectionReview rows exist."""
    return (
        db.query(DetectionReview.id)
        .filter(DetectionReview.inspection_id == inspection_id)
        .first()
        is not None
    )


def compute_review_diff(db: Session, inspection_id: str) -> dict:
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

    per_image: List[dict] = []
    for img_id, img_reviews in reviews_by_image.items():
        img = images_by_id.get(img_id)
        cv_count = cv_count_by_image.get(img_id, 0)
        img_accepted = sum(1 for r in img_reviews if r.action == "accepted")
        img_modified = sum(1 for r in img_reviews if r.action == "modified")
        img_added = sum(1 for r in img_reviews if r.action == "added")
        img_final = img_accepted + img_modified + img_added
        img_pct = round((img_accepted + img_modified) / cv_count * 100, 1) if cv_count else 0.0
        per_image.append({
            "image_id": img_id,
            "filename": img.filename if img else "",
            "cv_count": cv_count,
            "final_count": img_final,
            "accuracy_pct": img_pct,
            "actions": [{
                "cv_detection_id": r.cv_detection_id,
                "engineer_detection_id": r.engineer_detection_id,
                "action": r.action,
                "notes": r.notes,
            } for r in img_reviews],
        })

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

    damage_type_accuracy: Dict[str, dict] = {}
    for key, c in dmg.items():
        pct = round((c["accepted"] + c["modified"]) / c["cv"] * 100, 1) if c["cv"] else 0.0
        damage_type_accuracy[key] = {
            "cv": c["cv"], "accepted": c["accepted"], "rejected": c["rejected"],
            "modified": c["modified"], "pct": pct,
        }

    # ── modification log ──────────────────────────────────────────────────────
    modifications = [
        {
            "cv_detection_id": r.cv_detection_id,
            "image_filename": images_by_id[r.image_id].filename if r.image_id in images_by_id else None,
            "delta": r.delta_json,
            "notes": r.notes,
        }
        for r in reviews if r.action == "modified"
    ]

    return {
        "inspection_id": inspection_id,
        "reviewed_by": reviewed_by,
        "reviewed_at": reviewed_at,
        "totals": {
            "cv_detections": total_cv,
            "accepted": counts["accepted"],
            "rejected": counts["rejected"],
            "modified": counts["modified"],
            "engineer_added": counts["added"],
            "final_count": final_count,
            "accuracy_pct": accuracy,
        },
        "per_image": per_image,
        "damage_type_accuracy": damage_type_accuracy,
        "modifications": modifications,
    }
