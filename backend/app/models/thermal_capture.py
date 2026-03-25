import uuid
from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base


class ThermalCapture(Base):
    __tablename__ = "thermal_captures"

    id                  = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    image_id            = Column(String(36), ForeignKey("images.id"), nullable=False)
    mission_id          = Column(String(36), ForeignKey("missions.id"), nullable=True)

    min_temp_c          = Column(Float, nullable=True)
    max_temp_c          = Column(Float, nullable=True)
    avg_temp_c          = Column(Float, nullable=True)

    raw_thermal_path    = Column(String(500), nullable=True)
    heatmap_path        = Column(String(500), nullable=True)
    palette             = Column(String(50), nullable=False, default="ironbow")
    radiometric_data    = Column(JSONB, nullable=True)

    created_at          = Column(DateTime, server_default=func.now(), nullable=False)
