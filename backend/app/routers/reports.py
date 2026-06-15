import json
import re
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.image import Image
from app.models.inspection import Inspection, InspectionStatus
from app.models.user import User
from app.services.reports.db_loader import load_inspection_records
from app.services.reports.metrics import calculate_metrics
from app.services.reports.narrative import generate_narrative
from app.services.reports.pdf_report import generate_pdf
from app.services.reports.report_builder import build_report_data
from app.services.reports.annotated_zip import build_annotated_zip
from app.services.reports.review_diff import compute_review_diff, has_review_data
from app.services.reports.review_export import build_review_export
from app.services.reports.review_report import generate_review_report_pdf

router = APIRouter()

# Mounted at /api/v1 (NOT /api/v1/reports) so the download URL matches the
# review flow's /inspections/{id}/... endpoint family.
review_report_router = APIRouter()


def _require_org(user: User) -> str:
    if not user.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Your account is not attached to an organization.",
        )
    return user.organization_id


def _slug(name: str) -> str:
    return (
        (name or "inspection")
        .lower()
        .replace(" ", "-")
        .replace("'", "")
        .replace("/", "-")
    )


@router.get("/inspections/{inspection_id}/preview")
def report_preview(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_org(current_user)
    try:
        records, meta = load_inspection_records(db, inspection_id, org_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="This inspection has no detections to report on yet.",
        )

    metrics     = calculate_metrics(records)
    narrative   = generate_narrative(metrics)
    report_data = build_report_data(records, meta, narrative)

    response = {
        "metadata":       report_data["metadata"],
        "summary":        report_data["summary"],
        "image_findings": report_data["image_findings"],
        "narrative":      narrative,
        "metrics":        metrics,
    }
    # Engineer review section — only present when review rows exist
    # (inspection already org-scoped by load_inspection_records above)
    if has_review_data(db, inspection_id):
        response["review"] = compute_review_diff(db, inspection_id)
    return response


@router.get("/inspections/{inspection_id}/pdf")
def report_pdf(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _require_org(current_user)
    try:
        records, meta = load_inspection_records(db, inspection_id, org_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="This inspection has no detections to report on yet.",
        )

    metrics     = calculate_metrics(records)
    narrative   = generate_narrative(metrics)
    report_data = build_report_data(records, meta, narrative)
    # Engineer review section — only added when review rows exist; reports
    # without review data are unchanged (inspection already org-scoped above)
    if has_review_data(db, inspection_id):
        report_data["review"] = compute_review_diff(db, inspection_id)
    pdf_bytes   = generate_pdf(report_data)

    filename = f"{_slug(meta['asset_name'])}-inspection-report.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "inspection").strip())
    return cleaned.strip("_") or "inspection"


@review_report_router.get("/inspections/{inspection_id}/review-report.pdf")
def review_report_pdf(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dedicated Engineer Review Report — per-detection CV vs Correction PDF.

    Available while the review is in progress (pending_review — rendered with
    a REVIEW IN PROGRESS watermark) and after completion (review_completed).
    """
    org_id = _require_org(current_user)
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id,
        Inspection.organization_id == org_id,
    ).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    if inspection.status not in (
        InspectionStatus.pending_review.value,
        InspectionStatus.review_completed.value,
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Inspection status is '{inspection.status}' — the review report "
                   "is only available once an engineer review has been started.",
        )
    if not has_review_data(db, inspection_id):
        raise HTTPException(
            status_code=409,
            detail="This inspection has no engineer review data yet — "
                   "submit at least one image review first.",
        )

    pdf_bytes, inspection_name = generate_review_report_pdf(db, inspection_id)
    filename = f"{_sanitize_filename(inspection_name)}_review_report.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@review_report_router.get("/inspections/{inspection_id}/review-export.json")
def review_export_json(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Training-data JSON export — superset of the Annotation App's
    annotations.json v1.1 (final verified annotations with provenance) plus a
    lossless record of every CV prediction and the engineer's verdict.

    Available while the review is in progress (pending_review — partial
    export, unreviewed CV predictions carry review: null) and after
    completion (review_completed).
    """
    org_id = _require_org(current_user)
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id,
        Inspection.organization_id == org_id,
    ).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    if inspection.status not in (
        InspectionStatus.pending_review.value,
        InspectionStatus.review_completed.value,
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Inspection status is '{inspection.status}' — the review export "
                   "is only available once an engineer review has been started.",
        )
    if not has_review_data(db, inspection_id):
        raise HTTPException(
            status_code=409,
            detail="This inspection has no engineer review data yet — "
                   "submit at least one image review first.",
        )

    export = build_review_export(db, inspection_id)
    filename = f"{_sanitize_filename(inspection.name or inspection_id)}_review_export.json"
    return Response(
        content=json.dumps(export, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@review_report_router.get("/inspections/{inspection_id}/annotated-images.zip")
def annotated_images_zip(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ZIP of the FINAL annotated images — the clean engineer-verified
    deliverable. Available ONLY once the review is completed.

    Every image is included: those with verified detections are burned in
    (severity-coloured boxes + labels, on-screen palette), clean images are
    passed through losslessly under their original filename.
    """
    org_id = _require_org(current_user)
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id,
        Inspection.organization_id == org_id,
    ).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    if inspection.status != InspectionStatus.review_completed.value:
        raise HTTPException(
            status_code=409,
            detail="Annotated images are only available once the engineer "
                   "review is completed.",
        )

    has_images = db.query(Image.id).filter(
        Image.inspection_id == inspection_id
    ).first() is not None
    if not has_images:
        raise HTTPException(status_code=409, detail="This inspection has no images.")

    zip_bytes, inspection_name = build_annotated_zip(db, inspection_id)
    if not zip_bytes:
        raise HTTPException(
            status_code=409,
            detail="Source image files are not available on disk.",
        )

    filename = f"{_sanitize_filename(inspection_name)}_annotated_images.zip"
    return StreamingResponse(
        BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
