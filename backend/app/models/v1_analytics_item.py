import uuid
from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class V1AnalyticsItem(Base):
    __tablename__ = "v1_analytics_item"

    id                   = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    analytics_run_id     = Column(String(36), ForeignKey("v1_analytics_run.id"), nullable=False)
    organization_id      = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id             = Column(String(36), ForeignKey("assets.id"), nullable=False)
    segment_id           = Column(String(36), ForeignKey("asset_segments.segment_id"), nullable=True)
    defect_id            = Column(String(36), ForeignKey("detections.id"), nullable=True)

    status               = Column(String(20), nullable=False)    # new|persistent|resolved|worsening
    severity_prev        = Column(String(10), nullable=True)
    severity_now         = Column(String(10), nullable=False)
    priority_score       = Column(Float, nullable=False)
    priority_rank        = Column(Integer, nullable=False)
    recommended_action   = Column(String(20), nullable=False)    # monitor|re-inspect|escalate
    change_magnitude     = Column(Float, nullable=True)
    days_since_baseline  = Column(Integer, nullable=True)

    damage_type          = Column(String(100), nullable=True)
    component            = Column(String(100), nullable=True)
    location_description = Column(Text, nullable=True)

    created_at           = Column(DateTime, server_default=func.now(), nullable=False)
    item_metadata        = Column(JSONB, nullable=True, default=dict)
