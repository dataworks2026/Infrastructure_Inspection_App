from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

class DetectionResponse(BaseModel):
    id: str
    image_id: str
    infrastructure_type: str
    damage_type: str
    confidence: float
    bbox: BoundingBox
    severity: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True

class AnalysisResponse(BaseModel):
    image_id: str
    status: str
    infrastructure_type: str
    total_detections: int
    detections: List[DetectionResponse]
    annotated_image_url: Optional[str]
    message: str
