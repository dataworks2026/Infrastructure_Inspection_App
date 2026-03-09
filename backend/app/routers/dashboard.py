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

    # ── Query 1: asset totals in a single pass ────────────────────────────────
    asset_row = db.query(
        func.count(Asset.id).label("total"),
        func.count(case((Asset.status == "active", 1))).label("active"),
    ).filter(Asset.organization_id == org_id).first()

    # ── Query 2: inspection totals in one pass ────────────────────────────────
    insp_row = db.query(
        func.count(Inspection.id).label("total"),
        func.count(case((Inspection.status == "pending", 1))).label("pending"),
    ).filter(Inspection.organization_id == org_id).first()

    # ── Query 3: image + detection counts (scoped via org) ────────────────────
    total_images     = db.query(func.count(Image.id)).filter(Image.organization_id == org_id).scalar() or 0
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

    return {
        "total_assets":        asset_row.total  if asset_row else 0,
        "active_assets":       asset_row.active if asset_row else 0,
        "total_inspections":   insp_row.total   if insp_row else 0,
        "pending_inspections": insp_row.pending if insp_row else 0,
        "total_images":        total_images,
        "total_detections":    total_detections,
        "assets_by_type":      assets_by_type,
        "recent_inspections":  recent,
    }
