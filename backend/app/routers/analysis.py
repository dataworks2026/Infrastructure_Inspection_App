from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.image import Image
from app.models.inspection import Inspection
from app.models.asset import Asset
from app.models.detection import Detection
from app.schemas.detection import AnalysisResponse, DetectionResponse, BoundingBox
from app.services.model_router import ModelRouter
import os

router = APIRouter()
model_router = ModelRouter()

@router.post("/images/{image_id}/analyze", response_model=AnalysisResponse)
def analyze_image(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    inspection = db.query(Inspection).filter(Inspection.id == img.inspection_id).first()
    asset = db.query(Asset).filter(Asset.id == inspection.asset_id).first()
    infra_type = asset.infrastructure_type

    img.analysis_status = "processing"
    db.commit()

    try:
        abs_path = os.path.join(settings.STORAGE_BASE_PATH, img.stored_path)
        result = model_router.analyze(infra_type, abs_path)

        db.query(Detection).filter(Detection.image_id == image_id).delete()

        detection_records = []
        for det in result["detections"]:
            d = Detection(
                image_id=image_id,
                infrastructure_type=infra_type,
                damage_type=det["damage_type"],
                confidence=det["confidence"],
                bbox_x1=det["bbox"]["x1"],
                bbox_y1=det["bbox"]["y1"],
                bbox_x2=det["bbox"]["x2"],
                bbox_y2=det["bbox"]["y2"],
                severity=det.get("severity"),
                annotated_image_path=result.get("annotated_image_path"),
                raw_yolo_output=det
            )
            db.add(d)
            detection_records.append(d)

        img.analysis_status = "completed"
        db.commit()

        # ── Auto-complete the parent inspection when ALL its images are done ──
        all_images = db.query(Image).filter(Image.inspection_id == img.inspection_id).all()
        all_done   = all(i.analysis_status in ("completed", "failed") for i in all_images)
        any_failed = any(i.analysis_status == "failed" for i in all_images)
        if all_done and inspection:
            inspection.status = "failed" if any_failed and len(all_images) == sum(
                1 for i in all_images if i.analysis_status == "failed"
            ) else "completed"
            db.commit()

        return AnalysisResponse(
            image_id=image_id,
            status="completed",
            infrastructure_type=infra_type,
            total_detections=len(result["detections"]),
            detections=[
                DetectionResponse(
                    id=d.id, image_id=d.image_id,
                    infrastructure_type=d.infrastructure_type,
                    damage_type=d.damage_type, confidence=d.confidence,
                    bbox=BoundingBox(x1=d.bbox_x1, y1=d.bbox_y1, x2=d.bbox_x2, y2=d.bbox_y2),
                    severity=d.severity, created_at=d.created_at
                ) for d in detection_records
            ],
            annotated_image_url=f"/storage/{result['annotated_image_path']}" if result.get("annotated_image_path") else None,
            message=f"Found {len(result['detections'])} detections"
        )
    except Exception as e:
        img.analysis_status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@router.get("/images/{image_id}/detections")
def get_detections(image_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    img = db.query(Image).filter(Image.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    dets = db.query(Detection).filter(Detection.image_id == image_id).all()
    return {
        "image_id": image_id,
        "analysis_status": img.analysis_status,
        "total_detections": len(dets),
        "detections": [{"id": d.id, "damage_type": d.damage_type, "confidence": d.confidence,
                        "bbox": {"x1": d.bbox_x1, "y1": d.bbox_y1, "x2": d.bbox_x2, "y2": d.bbox_y2},
                        "severity": d.severity} for d in dets],
        "annotated_image_url": f"/storage/{dets[0].annotated_image_path}" if dets and dets[0].annotated_image_path else None
    }
