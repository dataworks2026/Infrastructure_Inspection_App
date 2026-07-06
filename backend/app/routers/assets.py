from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, text, bindparam
from typing import List, Optional
from app.core.deps import get_db, get_current_user
from app.database import Base
from app.models.user import User
from app.models.asset import Asset
from app.models.inspection import Inspection
from app.models.image import Image
from app.models.mission import Mission
from app.models.v1_analytics_run import V1AnalyticsRun
from app.models.v1_analytics_item import V1AnalyticsItem
from app.models.v1_analytics_reason import V1AnalyticsReason
from app.routers.inspections import cascade_delete_inspection
from app.schemas.asset import AssetCreate, AssetUpdate, AssetResponse

router = APIRouter()

# Tables with an asset_id FK handled explicitly by delete_asset.
_ASSET_DELETE_HANDLED = {
    "assets", "inspections", "images", "detections",
    "missions", "v1_analytics_run", "v1_analytics_item",
}
# Any OTHER table that references an asset — computed once from the mapped
# metadata (no runtime DB reflection, which would interfere with the request's
# transaction). delete_asset sweeps these so an asset delete can never FK-fail
# on a stray reference (asset_segments, risk/maintenance, damage_progression…).
_ASSET_REF_TABLES = [
    t.name for t in Base.metadata.tables.values()
    if "asset_id" in t.columns and t.name not in _ASSET_DELETE_HANDLED
]
# Mission-owned child tables (mission_waypoints, telemetry_points, flight_logs,
# thermal_captures, mission_records) — their rows must be cleared before the
# parent missions are deleted, or the FK blocks the delete. inspections/images
# also carry a mission_id back-reference but are handled by the asset cascade
# (and are excluded here so we never delete them via the mission path).
_MISSION_REF_TABLES = [
    t.name for t in Base.metadata.tables.values()
    if "mission_id" in t.columns and t.name not in _ASSET_DELETE_HANDLED
]

def _enrich_assets(assets: List[Asset], db: Session) -> List[AssetResponse]:
    """
    Enrich a list of assets with inspection_count + last_inspection_at
    using only 2 bulk queries instead of 2*N individual queries.
    """
    if not assets:
        return []

    asset_ids = [a.id for a in assets]

    # ── Query 1: count of inspections per asset ──────────────────────────────
    count_rows = (
        db.query(Inspection.asset_id, func.count(Inspection.id).label("cnt"))
        .filter(Inspection.asset_id.in_(asset_ids))
        .group_by(Inspection.asset_id)
        .all()
    )
    counts = {row.asset_id: row.cnt for row in count_rows}

    # ── Query 2: most-recent inspection date per asset ───────────────────────
    last_rows = (
        db.query(Inspection.asset_id, func.max(func.coalesce(Inspection.inspected_at, Inspection.inspection_date, Inspection.created_at)).label("last"))
        .filter(Inspection.asset_id.in_(asset_ids))
        .group_by(Inspection.asset_id)
        .all()
    )
    last_dates = {row.asset_id: row.last for row in last_rows}

    # ── Query 3: count of images per asset (via inspections) ─────────────────
    img_rows = (
        db.query(Inspection.asset_id, func.count(Image.id).label("cnt"))
        .join(Image, Image.inspection_id == Inspection.id)
        .filter(Inspection.asset_id.in_(asset_ids))
        .group_by(Inspection.asset_id)
        .all()
    )
    img_counts = {row.asset_id: row.cnt for row in img_rows}

    result = []
    for a in assets:
        result.append(AssetResponse(
            id=a.id,
            name=a.name,
            infrastructure_type=a.infrastructure_type,
            location_name=a.location_name,
            latitude=a.latitude,
            longitude=a.longitude,
            status=a.status,
            created_at=a.created_at,
            inspection_count=counts.get(a.id, 0),
            image_count=img_counts.get(a.id, 0),
            last_inspection_at=last_dates.get(a.id),
        ))
    return result


@router.get("", response_model=List[AssetResponse])
def list_assets(
    infrastructure_type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    org_id = current_user.organization_id
    q = db.query(Asset).filter(Asset.organization_id == org_id)
    if infrastructure_type:
        q = q.filter(Asset.infrastructure_type == infrastructure_type)
    if status:
        q = q.filter(Asset.status == status)
    assets = q.order_by(Asset.created_at.desc()).all()
    return _enrich_assets(assets, db)


@router.post("", response_model=AssetResponse, status_code=201)
def create_asset(data: AssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = Asset(**data.model_dump(), created_by=current_user.id, organization_id=current_user.organization_id)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return AssetResponse(**{**asset.__dict__, "inspection_count": 0, "image_count": 0, "last_inspection_at": None})


@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.organization_id == current_user.organization_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    enriched = _enrich_assets([asset], db)
    return enriched[0]


@router.patch("/{asset_id}", response_model=AssetResponse)
def update_asset(asset_id: str, data: AssetUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.organization_id == current_user.organization_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(asset)
    enriched = _enrich_assets([asset], db)
    return enriched[0]


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.organization_id == current_user.organization_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # 1. Delete every inspection's full subtree (detections, images, reviews,
    #    per-inspection analytics/risk). Missions keep their history (id nulled).
    inspections = db.query(Inspection).filter(Inspection.asset_id == asset_id).all()
    for insp in inspections:
        cascade_delete_inspection(db, insp)

    # 2. Asset-level drone missions (the "Twin Updates" — asset_id FK, no cascade).
    #    Clear rows that reference these missions (mission_waypoints, …) first,
    #    or the missions delete violates their FK.
    mission_ids = [m.id for m in db.query(Mission.id).filter(Mission.asset_id == asset_id).all()]
    if mission_ids:
        for tbl in _MISSION_REF_TABLES:
            stmt = text(f'DELETE FROM "{tbl}" WHERE mission_id IN :mids').bindparams(
                bindparam("mids", expanding=True)
            )
            db.execute(stmt, {"mids": mission_ids})
    db.query(Mission).filter(Mission.asset_id == asset_id).delete()

    # 3. Analytics. This asset's items live under shared org-wide runs (one item
    #    per asset per run), so delete THIS asset's items + their reasons without
    #    touching the shared runs. Reasons (child of item) must go first.
    item_ids = [r.id for r in db.query(V1AnalyticsItem.id).filter(V1AnalyticsItem.asset_id == asset_id).all()]
    if item_ids:
        db.query(V1AnalyticsReason).filter(V1AnalyticsReason.analytics_item_id.in_(item_ids)).delete()
        db.query(V1AnalyticsItem).filter(V1AnalyticsItem.id.in_(item_ids)).delete()

    # Analytics runs specific to this asset (rare — most runs are org-wide and
    # shared, so are left intact). Clear any remaining items/reasons under them.
    run_ids = [r.id for r in db.query(V1AnalyticsRun.id).filter(V1AnalyticsRun.asset_id == asset_id).all()]
    if run_ids:
        run_item_ids = [r.id for r in db.query(V1AnalyticsItem.id).filter(V1AnalyticsItem.analytics_run_id.in_(run_ids)).all()]
        if run_item_ids:
            db.query(V1AnalyticsReason).filter(V1AnalyticsReason.analytics_item_id.in_(run_item_ids)).delete()
            db.query(V1AnalyticsItem).filter(V1AnalyticsItem.analytics_run_id.in_(run_ids)).delete()
        db.query(V1AnalyticsRun).filter(V1AnalyticsRun.id.in_(run_ids)).delete()

    # 4. Sweep any remaining asset-referencing table (precomputed from metadata)
    #    so the asset delete can never FK-fail on a stray reference.
    for tbl in _ASSET_REF_TABLES:
        db.execute(text(f'DELETE FROM "{tbl}" WHERE asset_id = :aid'), {"aid": asset_id})

    db.delete(asset)
    db.commit()
