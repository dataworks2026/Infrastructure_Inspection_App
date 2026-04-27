import uuid
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class V1AnalyticsRun(Base):
    """One execution of the analytics pipeline.

    A run can be scoped at three different levels depending on how
    it is triggered:
      - Org-wide run    : analyses every asset in an organization;
                          inspection_id and asset_id are NULL.
      - Per-asset run   : deep dive on a single asset;
                          asset_id is populated, inspection_id may be NULL.
      - Per-inspection  : tied to one specific inspection (legacy scope);
                          both inspection_id and asset_id are populated.

    organization_id is always populated for multi-tenant isolation.
    """

    __tablename__ = "v1_analytics_run"

    id                       = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # inspection_id / asset_id are nullable so org-wide runs (the
    # default POST /api/v1/predictive/run scope) can be recorded
    # without a synthetic placeholder FK.
    inspection_id            = Column(String(36), ForeignKey("inspections.id"), nullable=True)
    baseline_inspection_id   = Column(String(36), ForeignKey("inspections.id"), nullable=True)
    organization_id          = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id                 = Column(String(36), ForeignKey("assets.id"), nullable=True)

    status                   = Column(String(20), nullable=False)    # running|completed|failed
    engine_version           = Column(String(10), nullable=False)
    schema_version           = Column(String(10), nullable=False)

    created_at               = Column(DateTime, server_default=func.now(), nullable=False)
    completed_at             = Column(DateTime, nullable=True)
    processing_time_ms       = Column(Integer, nullable=True)
    total_items_analyzed     = Column(Integer, nullable=False, default=0)
    error_message            = Column(Text, nullable=True)
    run_metadata             = Column(JSONB, nullable=True, default=dict)
