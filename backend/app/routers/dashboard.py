from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.models.inspection import Inspection
from app.models.image import Image
from app.models.detection import Detection

router = APIRouter()

@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):

    org_id = current_user.organization_id

    # ── Query 1: asset totals ──────────────────────────────────────────────────
    asset_row = db.query(
        func.count(Asset.id).label("total"),
        func.count(case((Asset.status == "active", 1))).label("active"),
    ).filter(Asset.organization_id == org_id).first()

    # ── Query 2: inspection totals ─────────────────────────────────────────────
    insp_row = db.query(
        func.count(Inspection.id).label("total"),
        func.count(case((Inspection.status == "pending", 1))).label("pending"),
    ).filter(Inspection.organization_id == org_id).first()

    # ── Query 3: image + detection counts ─────────────────────────────────────
    total_images = db.query(func.count(Image.id)).filter(Image.organization_id == org_id).scalar() or 0
    total_detections = (
        db.query(func.count(Detection.id))
        .join(Image, Detection.image_id == Image.id)
        .filter(Image.organization_id == org_id)
        .scalar() or 0
    )

    # ── Query 4: assets by infrastructure type ────────────────────────────────
    type_rows = (
        db.query(Asset.infrastructure_type, func.count(Asset.id).label("cnt"))
        .filter(Asset.organization_id == org_id)
        .group_by(Asset.infrastructure_type)
        .all()
    )
    assets_by_type = {row.infrastructure_type: row.cnt for row in type_rows}

    # ── Query 5: recent inspections (limit 5) ─────────────────────────────────
    recent_inspections = (
        db.query(Inspection)
        .filter(Inspection.organization_id == org_id)
        .order_by(Inspection.created_at.desc())
        .limit(5)
        .all()
    )
    recent = [
        {
            "id": i.id,
            "name": i.name,
            "asset_id": i.asset_id,
            "status": i.status,
            "created_at": i.created_at.isoformat() if i.created_at else None,
        }
        for i in recent_inspections
    ]

    # ── Query 6: recent analyzed images (dashboard carousel) ──────────────────
    recent_img_rows = (
        db.query(
            Image.id,
            Image.filename,
            Image.stored_path,
            Inspection.id.label("inspection_id"),
            Inspection.name.label("inspection_name"),
            Asset.id.label("asset_id"),
            Asset.name.label("asset_name"),
            func.count(Detection.id).label("detection_count"),
            func.max(Detection.severity).label("max_severity"),
        )
        .join(Inspection, Image.inspection_id == Inspection.id)
        .join(Asset, Inspection.asset_id == Asset.id)
        .outerjoin(Detection, Detection.image_id == Image.id)
        .filter(
            Image.organization_id == org_id,
            Image.analysis_status == "completed",
            Image.deleted_at.is_(None),
        )
        .group_by(
            Image.id, Image.filename, Image.stored_path,
            Inspection.id, Inspection.name, Asset.id, Asset.name,
        )
        .order_by(func.max(Detection.severity).desc().nullslast(), Image.created_at.desc())
        .limit(30)
        .all()
    )
    recent_analyzed_images = [
        {
            "id": row.id,
            "filename": row.filename,
            "url": f"/storage/{row.stored_path}" if row.stored_path else "",
            "inspection_id": row.inspection_id,
            "inspection_name": row.inspection_name,
            "asset_id": row.asset_id,
            "asset_name": row.asset_name,
            "detection_count": row.detection_count,
            "max_severity": row.max_severity,
        }
        for row in recent_img_rows
    ]

    # ── Query 7: asset health table (ranked critical-first) ───────────────────
    asset_health_rows = (
        db.query(
            Asset.id,
            Asset.name,
            Asset.infrastructure_type,
            Asset.status,
            func.count(Inspection.id.distinct()).label("inspection_count"),
            func.count(Detection.id).label("total_detections"),
            func.max(Detection.severity).label("worst_severity"),
        )
        .outerjoin(Inspection, Inspection.asset_id == Asset.id)
        .outerjoin(Image, Image.inspection_id == Inspection.id)
        .outerjoin(Detection, Detection.image_id == Image.id)
        .filter(Asset.organization_id == org_id)
        .group_by(Asset.id, Asset.name, Asset.infrastructure_type, Asset.status)
        .all()
    )
    sev_order = {"S3": 0, "S2": 1, "S1": 2, "S0": 3}
    asset_health = sorted(
        [
            {
                "id": row.id,
                "name": row.name,
                "infrastructure_type": row.infrastructure_type,
                "status": row.status,
                "inspection_count": row.inspection_count,
                "total_detections": row.total_detections,
                "worst_severity": row.worst_severity,
            }
            for row in asset_health_rows
        ],
        key=lambda x: (sev_order.get(x["worst_severity"], 4), -x["total_detections"])
    )

    # ── Query 8: severity breakdown (for donut) ───────────────────────────────
    sev_rows = (
        db.query(Detection.severity, func.count(Detection.id).label("cnt"))
        .join(Image, Detection.image_id == Image.id)
        .filter(Image.organization_id == org_id, Detection.severity.isnot(None))
        .group_by(Detection.severity)
        .all()
    )
    severity_breakdown = {row.severity: row.cnt for row in sev_rows}

    # ── Fleet health % ─────────────────────────────────────────────────────────
    total_a  = asset_row.total  if asset_row else 0
    active_a = asset_row.active if asset_row else 0
    fleet_health_pct = round((active_a / total_a * 100) if total_a > 0 else 0)

    return {
        "total_assets":           total_a,
        "active_assets":          active_a,
        "total_inspections":      insp_row.total   if insp_row else 0,
        "pending_inspections":    insp_row.pending if insp_row else 0,
        "total_images":           total_images,
        "total_detections":       total_detections,
        "assets_by_type":         assets_by_type,
        "recent_inspections":     recent,
        "recent_analyzed_images": recent_analyzed_images,
        "asset_health":           asset_health,
        "severity_breakdown":     severity_breakdown,
        "fleet_health_pct":       fleet_health_pct,
    }
