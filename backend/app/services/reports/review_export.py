"""Training-data JSON export for the Engineer Review Flow.

Builds a superset of the Annotation App's annotations.json v1.1 format so a
completed (or in-progress) engineer review can feed the same CV training
pipeline, while also preserving a lossless record of every CV prediction and
the engineer's verdict on it.

Served by GET /api/v1/inspections/{inspection_id}/review-export.json.
Callers must org-scope the inspection and verify review data exists first —
this module queries by inspection_id only (same contract as review_report /
review_diff).
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection
from app.services.reports.damage_codes import CODE_LABELS
from app.services.reports.review_diff import compute_review_diff
from app.services.reports.review_report import _SEV_NAMES, _damage_code, _severity_num

EXPORT_VERSION = "1.1"
EXPORT_VARIANT = "engineer_review"
SOURCE_APP = "inspection_app"


# ── Field formatters (Detection ORM row → export shapes) ─────────────────────

def _bbox_obj(det: Detection) -> dict:
    """x1y1x2y2 → annotation-app {x, y, width, height}, 2dp, orientation-safe."""
    x1, x2 = sorted((float(det.bbox_x1 or 0), float(det.bbox_x2 or 0)))
    y1, y2 = sorted((float(det.bbox_y1 or 0), float(det.bbox_y2 or 0)))
    return {
        "x": round(x1, 2),
        "y": round(y1, 2),
        "width": round(x2 - x1, 2),
        "height": round(y2 - y1, 2),
    }


def _damage_type_obj(det: Detection) -> Optional[dict]:
    meta = det.domain_metadata or {}
    if not det.damage_type and not meta.get("code"):
        return None
    code = _damage_code({"domain_metadata": meta, "damage_type": det.damage_type})
    label = CODE_LABELS.get(code)
    if not label:
        label = (det.damage_type or "Unknown").replace("_", " ").title()
    return {"code": code, "label": label}


def _severity_obj(det: Detection) -> Optional[dict]:
    if not det.severity:
        return None
    level = _severity_num(det.severity) or 1   # 'S0' / unparseable → 1
    return {"level": level, "label": _SEV_NAMES[level]}


def _segments_list(det: Detection) -> List[dict]:
    segs = (det.domain_metadata or {}).get("segments") or []
    return [{"code": s} for s in segs]


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _annotation(det: Detection, origin: str, cv_detection_id: Optional[str]) -> dict:
    """Final verified annotation — annotation-app v1.1 shape + provenance."""
    meta = det.domain_metadata or {}
    return {
        "annotation_id": det.id,
        "bbox": _bbox_obj(det),
        "shape_type": det.shape_type or "rect",
        "damage_type": _damage_type_obj(det),
        "severity": _severity_obj(det),
        "structural_segments": _segments_list(det),
        "notes": det.inspector_notes,
        "defect_id": meta.get("defect_id"),
        "origin": origin,
        "cv_detection_id": cv_detection_id,
    }


def _cv_prediction(det: Detection, review: Optional[DetectionReview]) -> dict:
    """Frozen CV original + the engineer's verdict (null when not yet reviewed)."""
    confidence = float(
        det.confidence_score if det.confidence_score is not None
        else (det.confidence or 0.0)
    )
    review_obj = None
    if review is not None:
        review_obj = {
            "action": review.action,
            "engineer_annotation_id": (
                review.engineer_detection_id if review.action == "modified" else None
            ),
            "delta": review.delta_json if review.action == "modified" else None,
            "notes": review.notes,
            "reviewed_by": review.reviewed_by,
            "reviewed_at": _iso(review.reviewed_at),
        }
    return {
        "detection_id": det.id,
        "bbox": _bbox_obj(det),
        "shape_type": det.shape_type or "rect",
        "damage_type": _damage_type_obj(det),
        "severity": _severity_obj(det),
        "confidence": confidence,
        "model_name": det.model_name,
        "model_version": det.model_version,
        "review": review_obj,
    }


# ── Export assembly ───────────────────────────────────────────────────────────

def build_review_export(db: Session, inspection_id: str) -> dict:
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    asset = (db.query(Asset).filter(Asset.id == inspection.asset_id).first()
             if inspection else None)

    diff = compute_review_diff(db, inspection_id)

    images = db.query(Image).filter(Image.inspection_id == inspection_id).all()
    images_by_id: Dict[str, Image] = {i.id: i for i in images}
    image_ids = list(images_by_id)

    cv_detections: List[Detection] = []
    if image_ids:
        cv_detections = db.query(Detection).filter(
            Detection.image_id.in_(image_ids),
            Detection.source == "cv_model",
            Detection.is_locked.is_(True),
        ).all()
    cv_by_id: Dict[str, Detection] = {d.id: d for d in cv_detections}
    cv_by_image: Dict[str, List[Detection]] = {}
    for d in cv_detections:
        cv_by_image.setdefault(d.image_id, []).append(d)

    reviews: List[DetectionReview] = db.query(DetectionReview).filter(
        DetectionReview.inspection_id == inspection_id
    ).order_by(DetectionReview.created_at).all()
    review_by_cv_id: Dict[str, DetectionReview] = {
        r.cv_detection_id: r for r in reviews if r.cv_detection_id
    }

    eng_ids = {r.engineer_detection_id for r in reviews if r.engineer_detection_id}
    eng_by_id: Dict[str, Detection] = {}
    if eng_ids:
        for d in db.query(Detection).filter(Detection.id.in_(eng_ids)).all():
            eng_by_id[d.id] = d

    # Images with review activity, in first-reviewed order (matches the PDF)
    image_order: List[str] = []
    seen: set = set()
    for r in reviews:
        if r.image_id not in seen:
            seen.add(r.image_id)
            image_order.append(r.image_id)

    image_entries: List[dict] = []
    total_annotations = 0
    for img_id in image_order:
        img = images_by_id.get(img_id)
        img_reviews = [r for r in reviews if r.image_id == img_id]

        annotations: List[dict] = []
        for r in img_reviews:
            if r.action == "accepted":
                det = cv_by_id.get(r.cv_detection_id) if r.cv_detection_id else None
                if det is not None:
                    annotations.append(_annotation(det, "cv_accepted", det.id))
            elif r.action == "modified":
                eng = eng_by_id.get(r.engineer_detection_id) if r.engineer_detection_id else None
                if eng is not None:
                    annotations.append(_annotation(eng, "engineer_modified", r.cv_detection_id))
            elif r.action == "added":
                eng = eng_by_id.get(r.engineer_detection_id) if r.engineer_detection_id else None
                if eng is not None:
                    annotations.append(_annotation(eng, "engineer_added", None))
            # 'rejected' → cv_predictions only

        cv_predictions = [
            _cv_prediction(d, review_by_cv_id.get(d.id))
            for d in cv_by_image.get(img_id, [])
        ]

        total_annotations += len(annotations)
        image_entries.append({
            "image_id": img_id,
            "filename": ((img.filename or img.original_filename) if img else img_id),
            "asset_type": ((img.domain_metadata or {}).get("asset_type") if img else None),
            "annotation_status": "completed",
            "num_annotations": len(annotations),
            "annotations": annotations,
            "cv_predictions": cv_predictions,
        })

    return {
        "inspection_id": inspection_id,
        "export_version": EXPORT_VERSION,
        "export_variant": EXPORT_VARIANT,
        "source_app": SOURCE_APP,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "asset_name": asset.name if asset else "",
        "infrastructure_type": asset.infrastructure_type if asset else None,
        "review": {
            "status": inspection.status if inspection else "",
            "reviewed_by": diff.get("reviewed_by"),
            "reviewed_at": _iso(diff.get("reviewed_at")),
            "totals": diff["totals"],
        },
        "total_images": len(image_entries),
        "total_annotations": total_annotations,
        "images": image_entries,
    }
