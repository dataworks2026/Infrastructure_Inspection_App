from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class InspectionCreate(BaseModel):
    asset_id: str
    name: str
    inspected_at: Optional[datetime] = None
    weather_conditions: Optional[str] = None
    inspector_name: Optional[str] = None

class InspectionUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    inspected_at: Optional[datetime] = None
    weather_conditions: Optional[str] = None

class InspectionResponse(BaseModel):
    id: str
    asset_id: str
    name: str
    inspected_at: Optional[datetime]
    weather_conditions: Optional[str]
    inspector_name: Optional[str]
    status: str
    created_at: datetime
    image_count: int = 0

    class Config:
        from_attributes = True
