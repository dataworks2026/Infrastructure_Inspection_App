from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.models.inspection import Inspection
from app.models.image import Image
from app.schemas.asset import AssetCreate, AssetUpdate, AssetResponse

router = APIRouter()

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
    db.delete(asset)
    db.commit()
