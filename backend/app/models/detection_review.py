import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class DetectionReview(Base):
    # Engineer review audit trail — one row per CV detection decision or engineer addition
    __tablename__ = "detection_reviews"

    id                    = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id       = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    image_id              = Column(String(36), ForeignKey("images.id", ondelete="CASCADE"), nullable=False, index=True)
    inspection_id         = Column(String(36), ForeignKey("inspections.id", ondelete="CASCADE"), nullable=False, index=True)

    # original CV detection (NULL when action='added' — engineer created from scratch)
    cv_detection_id       = Column(String(36), ForeignKey("detections.id"), nullable=True, index=True)
    # engineer's corrected detection (NULL when action='rejected' or 'accepted')
    engineer_detection_id = Column(String(36), ForeignKey("detections.id"), nullable=True)

    action                = Column(String(20), nullable=False, index=True)  # 'accepted' | 'rejected' | 'modified' | 'added'
    delta_json            = Column(JSONB, nullable=True)                    # field-level diff (populated for 'modified')
    notes                 = Column(Text, nullable=True)                     # engineer's reasoning for the change

    reviewed_by           = Column(String(255), nullable=True)
    reviewed_at           = Column(DateTime, server_default=func.now(), nullable=True)
    created_at            = Column(DateTime, server_default=func.now(), nullable=False)
