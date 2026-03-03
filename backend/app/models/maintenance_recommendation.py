import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Date, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base

class MaintenanceRecommendation(Base):
    __tablename__ = "maintenance_recommendations"

    recommendation_id                = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id                  = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id                         = Column(String(36), ForeignKey("assets.id"), nullable=False)
    risk_id                          = Column(String(36), ForeignKey("risk_assessments.risk_id"), nullable=True)

    recommendation_type              = Column(String(50), nullable=True)
    priority                         = Column(String(50), nullable=False)    # immediate|urgent|scheduled|monitor|defer
    description                      = Column(Text, nullable=False)
    recommended_by_date              = Column(Date, nullable=True)
    optimal_execution_window_start   = Column(Date, nullable=True)
    optimal_execution_window_end     = Column(Date, nullable=True)

    estimated_cost_min               = Column(Float, nullable=True)
    estimated_cost_max               = Column(Float, nullable=True)
    estimated_duration_days          = Column(Integer, nullable=True)
    downtime_required                = Column(Boolean, nullable=False, default=False)
    safety_critical                  = Column(Boolean, nullable=False, default=False)
    regulatory_compliance_required   = Column(Boolean, nullable=False, default=False)

    justification                    = Column(Text, nullable=True)
    alternative_options              = Column(JSONB, nullable=True, default=dict)
    consequences_if_deferred         = Column(Text, nullable=True)

    status                           = Column(String(50), nullable=False, default="pending")
    approved_by                      = Column(String(36), ForeignKey("users.id"), nullable=True)
    approved_at                      = Column(DateTime, nullable=True)
    scheduled_for                    = Column(Date, nullable=True)
    completed_at                     = Column(DateTime, nullable=True)

    created_at                       = Column(DateTime, server_default=func.now(), nullable=False)
    created_by                       = Column(String(36), ForeignKey("users.id"), nullable=True)
