import uuid
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class V1AnalyticsRun(Base):
    __tablename__ = "v1_analytics_run"

    id                       = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    inspection_id            = Column(String(36), ForeignKey("inspections.id"), nullable=False)
    baseline_inspection_id   = Column(String(36), ForeignKey("inspections.id"), nullable=True)
    organization_id          = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id                 = Column(String(36), ForeignKey("assets.id"), nullable=False)

    status                   = Column(String(20), nullable=False)    # running|completed|failed
    engine_version           = Column(String(10), nullable=False)
    schema_version           = Column(String(10), nullable=False)

    created_at               = Column(DateTime, server_default=func.now(), nullable=False)
    completed_at             = Column(DateTime, nullable=True)
    processing_time_ms       = Column(Integer, nullable=True)
    total_items_analyzed     = Column(Integer, nullable=False, default=0)
    error_message            = Column(Text, nullable=True)
    run_metadata             = Column(JSONB, nullable=True, default=dict)
