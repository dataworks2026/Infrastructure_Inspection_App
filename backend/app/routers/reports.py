from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.services.reports.db_loader import load_inspection_records
from app.services.reports.metrics import calculate_metrics
from app.services.reports.narrative import generate_narrative
from app.services.reports.pdf_report import generate_pdf
from app.services.reports.report_builder import build_report_data

router = APIRouter()


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

    return {
        "metadata":       report_data["metadata"],
        "summary":        report_data["summary"],
        "image_findings": report_data["image_findings"],
        "narrative":      narrative,
        "metrics":        metrics,
    }


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
    pdf_bytes   = generate_pdf(report_data)

    filename = f"{_slug(meta['asset_name'])}-inspection-report.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
