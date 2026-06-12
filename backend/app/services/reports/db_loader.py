"""Build the enriched detection records + inspection metadata directly from
the live database — replaces the JSON-file `parser.py` from Andrew's tool.

The output shape is identical to what the report pipeline (metrics →
narrative → report_builder → pdf_report) expects.
"""
import os
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset import Asset
from app.models.detection import Detection
from app.models.detection_review import DetectionReview
from app.models.image import Image
from app.models.inspection import Inspection
from app.models.organization import Organization


SEVERITY_TO_RISK = {
    "S1": "low",
    "S2": "medium",
    "S3": "high",
    "S4": "critical",
}

# Production data also contains "S0" (sub-threshold detections — visible
# growth/staining classified as no structural concern). Andrew's matrix is
# Minor/Moderate/Advanced/Severe (S1–S4), so we fold S0 into S1/Minor here
# to preserve the detection in the report rather than drop it silently.
_SEVERITY_NORMALIZE = {"S0": "S1"}


def load_inspection_records(
    db: Session,
    inspection_id: str,
    organization_id: Optional[str] = None,
) -> tuple[list[dict], dict]:
    """Load enriched detection records and PDF-cover metadata for a single
    inspection.

    Returns
    -------
    (records, meta)
        records — list[dict] with the same fields parser.enrich_detection
                  produced (defect_type, severity, risk_level, confidence,
                  organization, asset_type, inspection_date, component_type,
                  image_filename, damage_description, ...).
        meta    — dict consumed by extract_metadata's caller
                  (organization_name, asset_name, location_name,
                  infrastructure_type, inspection_date, inspection_type,
                  inspection_method, inspector_name, total_images, status,
                  inspection_id).

    Raises
    ------
    LookupError  — inspection not found, or wrong org scope.
    ValueError   — inspection has no detections.
    """
    q = db.query(Inspection).filter(Inspection.id == inspection_id)
    if organization_id:
        q = q.filter(Inspection.organization_id == organization_id)
    inspection = q.first()
    if inspection is None:
        raise LookupError(f"Inspection {inspection_id!r} not found")

    asset = db.query(Asset).filter(Asset.id == inspection.asset_id).first()
    if asset is None:
        raise LookupError(
            f"Asset {inspection.asset_id!r} not found for inspection {inspection_id!r}"
        )

    org_name = "Unknown"
    if asset.organization_id:
        org = (
            db.query(Organization)
            .filter(Organization.organization_id == asset.organization_id)
            .first()
        )
        if org:
            org_name = org.name

    images = (
        db.query(Image).filter(Image.inspection_id == inspection_id).all()
    )
    base = settings.STORAGE_BASE_PATH
    image_lookup = {
        img.id: {
            "filename": img.filename or img.original_filename or img.id,
            "component_type": img.component_type or "",
            "abs_path": (
                os.path.join(base, img.stored_path) if img.stored_path else None
            ),
        }
        for img in images
    }

    detections = (
        db.query(Detection)
        .filter(Detection.image_id.in_(image_lookup.keys()))
        .all()
        if image_lookup
        else []
    )

    # Engineer review filter — if this inspection has been (even partially)
    # reviewed, report only the VERIFIED detection set:
    #   - rejected CV detections are excluded
    #   - modified CV detections are excluded (the engineer's corrected
    #     duplicate is a normal Detection row on the image, so it is
    #     already in `detections` — keeping the stale original would
    #     double-count)
    #   - accepted CV detections, unreviewed CV detections (mid-review),
    #     and engineer-added detections stay included.
    # Inspections with no review rows are untouched.
    reviews = (
        db.query(DetectionReview.cv_detection_id, DetectionReview.action)
        .filter(DetectionReview.inspection_id == inspection_id)
        .all()
    )
    if reviews:
        excluded_ids = {
            cv_id
            for cv_id, action in reviews
            if cv_id and action in ("rejected", "modified")
        }
        detections = [d for d in detections if d.id not in excluded_ids]

    records: list[dict] = []
    for det in detections:
        img_meta = image_lookup.get(det.image_id)
        if img_meta is None:
            continue

        raw_severity = det.severity or ""
        severity = _SEVERITY_NORMALIZE.get(raw_severity, raw_severity)

        bbox = None
        if det.bbox_x1 is not None and det.bbox_x2 is not None:
            bbox = {
                "x1": float(det.bbox_x1), "y1": float(det.bbox_y1 or 0.0),
                "x2": float(det.bbox_x2), "y2": float(det.bbox_y2 or 0.0),
            }

        records.append({
            "detection_id":    det.id,
            "image_id":        det.image_id,
            "organization_id": asset.organization_id,
            "asset_id":        asset.id,
            "inspection_id":   inspection.id,
            "defect_type":     det.damage_type or "",
            "severity":        severity,
            "risk_level":      SEVERITY_TO_RISK.get(severity, "unknown"),
            "confidence":      float(det.confidence_score or det.confidence or 0.0),
            "organization":    org_name,
            "asset_type":      asset.infrastructure_type or "",
            "inspection_date": (
                inspection.inspection_date.isoformat()
                if inspection.inspection_date
                else (inspection.inspected_at.isoformat()
                      if inspection.inspected_at else "")
            ),
            "component_type":  img_meta["component_type"],
            "image_filename":  img_meta["filename"],
            "image_path":      img_meta["abs_path"],
            "bbox":            bbox,
            "damage_description": det.observable_evidence or "",
        })

    if not records:
        raise ValueError("no_detections")

    raw_date = (
        inspection.inspection_date.isoformat()
        if inspection.inspection_date
        else (inspection.inspected_at.isoformat()
              if inspection.inspected_at else "")
    )
    try:
        formatted_date = datetime.strptime(raw_date[:10], "%Y-%m-%d").strftime(
            "%B %d, %Y"
        )
    except (ValueError, TypeError):
        formatted_date = raw_date

    meta = {
        "organization_name":  org_name,
        "asset_name":         asset.name or "",
        "location_name":      asset.location_name or "",
        "infrastructure_type": asset.infrastructure_type or "",
        "inspection_date":    formatted_date,
        "inspection_type":    inspection.inspection_type or "",
        "inspection_method":  inspection.inspection_method or "",
        "inspector_name":     inspection.inspector_name or "",
        "total_images":       inspection.total_images or len(images),
        "status":             inspection.status or "",
        "inspection_id":      inspection.id,
    }

    return records, meta
