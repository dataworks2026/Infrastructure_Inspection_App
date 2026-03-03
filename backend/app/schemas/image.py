from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ImageUploadItem(BaseModel):
    """Single image entry returned after a successful upload."""
    id: str
    filename: str
    status: str


class ImageUploadResponse(BaseModel):
    """Response returned from POST /inspections/{id}/images/upload."""
    uploaded: int
    images: List[ImageUploadItem]


class ImageRecord(BaseModel):
    """Full image record returned when listing or fetching a single image."""
    id: str
    inspection_id: str
    filename: str
    original_filename: Optional[str] = None
    component_type: Optional[str] = None
    analysis_status: str
    url: str

    # Location & capture metadata
    capture_datetime: Optional[datetime] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None

    # Quality flags
    file_size_bytes: Optional[int] = None
    content_type: Optional[str] = None
    blur_detected: bool = False
    glare_detected: bool = False
    image_quality_score: Optional[float] = None

    # Annotation state
    annotation_status: str = "not_started"
    num_annotations: int = 0

    created_at: datetime

    class Config:
        from_attributes = True
