import uuid
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Boolean, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base

class Detection(Base):
    __tablename__ = "detections"

    id                          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id             = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    image_id                    = Column(String(36), ForeignKey("images.id"), nullable=False)
    damage_type_id              = Column(Integer, ForeignKey("damage_types.damage_type_id"), nullable=True)

    # legacy fields kept for backward compat with routes/services
    infrastructure_type         = Column(String, nullable=True)
    damage_type                 = Column(String, nullable=True)
    confidence                  = Column(Float, nullable=True)
    bbox_x1                     = Column(Float, nullable=True)
    bbox_y1                     = Column(Float, nullable=True)
    bbox_x2                     = Column(Float, nullable=True)
    bbox_y2                     = Column(Float, nullable=True)
    annotated_image_path        = Column(String, nullable=True)
    raw_yolo_output             = Column(JSONB, nullable=True)

    # schema fields
    model_name                  = Column(String(100), nullable=True)   # 'human_annotation' | 'yolov8-maritime' | etc.
    model_version               = Column(String(50), nullable=True)
    severity                    = Column(String(10), nullable=True)     # S1 | S2 | S3 | S4
    confidence_score            = Column(Float, nullable=True)          # schema canonical name
    bounding_box                = Column(JSONB, nullable=True)           # {x, y, width, height}
    shape_type                  = Column(String(20), nullable=True, default="rect")

    observable_evidence         = Column(Text, nullable=True)
    inspector_notes             = Column(Text, nullable=True)
    condition_trend             = Column(String(20), nullable=True)
    llm_risk_level              = Column(String(20), nullable=True)
    llm_reasoning               = Column(Text, nullable=True)
    repair_urgency              = Column(String(20), nullable=True)
    estimated_repair_cost_range = Column(String(50), nullable=True)
    domain_metadata             = Column(JSONB, nullable=True, default=dict)

    reviewed                    = Column(Boolean, nullable=False, default=False)
    reviewed_by                 = Column(String(100), nullable=True)
    review_date                 = Column(DateTime, nullable=True)

    detected_at                 = Column(DateTime, server_default=func.now(), nullable=False)
    created_at                  = Column(DateTime, server_default=func.now(), nullable=False)
