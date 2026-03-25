import uuid
from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base


class Mission(Base):
    __tablename__ = "missions"

    id                  = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id     = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    inspection_id       = Column(String(36), ForeignKey("inspections.id"), nullable=True)
    asset_id            = Column(String(36), ForeignKey("assets.id"), nullable=False)
    created_by          = Column(String(36), ForeignKey("users.id"), nullable=True)

    name                = Column(String(255), nullable=False)
    description         = Column(Text, nullable=True)
    routine_type        = Column(String(50), nullable=False)        # sweep/orbit/traverse/grid/crawl/scout
    status              = Column(String(50), nullable=False, default="planned")

    drone_model         = Column(String(100), nullable=True)
    drone_serial        = Column(String(100), nullable=True)
    sensor_payload      = Column(String(100), nullable=True)

    routine_params      = Column(JSONB, nullable=True)
    area_of_interest    = Column(JSONB, nullable=True)
    laanc_authorization_id = Column(String(100), nullable=True)
    preflight_checklist = Column(JSONB, nullable=True)

    planned_start       = Column(DateTime, nullable=True)
    actual_start        = Column(DateTime, nullable=True)
    actual_end          = Column(DateTime, nullable=True)
    flight_duration_s   = Column(Integer, nullable=True)

    total_waypoints     = Column(Integer, nullable=True)
    total_photos        = Column(Integer, nullable=False, default=0)
    photos_uploaded     = Column(Integer, nullable=False, default=0)
    photos_analyzed     = Column(Integer, nullable=False, default=0)

    odm_job_id          = Column(String(100), nullable=True)
    odm_status          = Column(String(50), nullable=True)

    created_at          = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at          = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
