from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class AssetCreate(BaseModel):
    name: str
    infrastructure_type: str
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str = "active"

class AssetUpdate(BaseModel):
    name: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: Optional[str] = None

class AssetResponse(BaseModel):
    id: str
    name: str
    infrastructure_type: str
    location_name: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    status: str
    created_at: datetime
    inspection_count: int = 0
    last_inspection_at: Optional[datetime] = None

    class Config:
        from_attributes = True
