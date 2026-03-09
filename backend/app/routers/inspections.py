from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.inspection import Inspection
from app.models.image import Image
from app.models.detection import Detection
from app.schemas.inspection import InspectionCreate, InspectionUpdate, InspectionResponse

router = APIRouter()

@router.get("", response_model=List[InspectionResponse])
def list_inspections(
    asset_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    org_id = current_user.organization_id
    q = db.query(Inspection).filter(Inspection.organization_id == org_id)
    if asset_id:
        q = q.filter(Inspection.asset_id == asset_id)
    inspections = q.order_by(Inspection.created_at.desc()).all()
    result = []
    for i in inspections:
        img_count = db.query(Image).filter(Image.inspection_id == i.id).count()
        result.append(InspectionResponse(
            id=i.id, asset_id=i.asset_id, name=i.name,
            inspected_at=i.inspected_at, weather_conditions=i.weather_conditions,
            inspector_name=i.inspector_name, status=i.status, created_at=i.created_at,
            image_count=img_count
        ))
    return result

@router.post("", response_model=InspectionResponse, status_code=201)
def create_inspection(data: InspectionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inspection = Inspection(**data.model_dump(), created_by=current_user.id, organization_id=current_user.organization_id)
    db.add(inspection)
    db.commit()
    db.refresh(inspection)
    return InspectionResponse(**{k: v for k, v in inspection.__dict__.items() if not k.startswith('_')}, image_count=0)

@router.get("/{inspection_id}", response_model=InspectionResponse)
def get_inspection(inspection_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id, Inspection.organization_id == current_user.organization_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    img_count = db.query(Image).filter(Image.inspection_id == inspection_id).count()
    return InspectionResponse(**{k: v for k, v in inspection.__dict__.items() if not k.startswith('_')}, image_count=img_count)

@router.patch("/{inspection_id}", response_model=InspectionResponse)
def update_inspection(inspection_id: str, data: InspectionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id, Inspection.organization_id == current_user.organization_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(inspection, field, value)
    db.commit()
    db.refresh(inspection)
    img_count = db.query(Image).filter(Image.inspection_id == inspection_id).count()
    return InspectionResponse(**{k: v for k, v in inspection.__dict__.items() if not k.startswith('_')}, image_count=img_count)

@router.delete("/{inspection_id}", status_code=204)
def delete_inspection(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id, Inspection.organization_id == current_user.organization_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    # Cascade: detections → images → inspection
    images = db.query(Image).filter(Image.inspection_id == inspection_id).all()
    for img in images:
        db.query(Detection).filter(Detection.image_id == img.id).delete()
    db.query(Image).filter(Image.inspection_id == inspection_id).delete()
    db.delete(inspection)
    db.commit()
