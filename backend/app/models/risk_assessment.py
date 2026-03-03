import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Date, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base

class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    risk_id                    = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id            = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id                   = Column(String(36), ForeignKey("assets.id"), nullable=False)
    detection_id               = Column(String(36), ForeignKey("detections.id"), nullable=True)
    inspection_run_id          = Column(String(36), ForeignKey("inspections.id"), nullable=True)

    assessment_type            = Column(String(50), nullable=False, default="automated")
    assessed_by_user_id        = Column(String(36), ForeignKey("users.id"), nullable=True)

    current_severity           = Column(String(10), nullable=True)
    damage_types_detected      = Column(JSONB, nullable=True)        # TEXT[] stored as JSON array
    risk_level                 = Column(String(20), nullable=False)
    risk_score                 = Column(Float, nullable=True)

    risk_30_days               = Column(Float, nullable=True)
    risk_90_days               = Column(Float, nullable=True)
    risk_180_days              = Column(Float, nullable=True)
    risk_365_days              = Column(Float, nullable=True)

    contributing_factors       = Column(JSONB, nullable=True, default=dict)
    asset_context              = Column(Text, nullable=True)
    projected_escalation_date  = Column(Date, nullable=True)
    escalation_threshold_met   = Column(Boolean, nullable=False, default=False)
    early_warning_flag         = Column(Boolean, nullable=False, default=False)

    maintenance_priority       = Column(Integer, nullable=True)
    recommended_action         = Column(Text, nullable=True)
    maintenance_window_start   = Column(Date, nullable=True)
    maintenance_window_end     = Column(Date, nullable=True)
    estimated_cost_range       = Column(String(50), nullable=True)

    status                     = Column(String(50), nullable=False, default="active")
    flagged_for_followup       = Column(Boolean, nullable=False, default=False)
    assigned_to                = Column(String(100), nullable=True)

    llm_model_version          = Column(String(50), nullable=True)
    llm_reasoning              = Column(Text, nullable=True)
    confidence_score           = Column(Float, nullable=True)
    citations                  = Column(JSONB, nullable=True, default=dict)
    assumptions                = Column(Text, nullable=True)
    limitations                = Column(Text, nullable=True)
    full_assessment            = Column(JSONB, nullable=True, default=dict)
    report_url                 = Column(Text, nullable=True)

    created_at                 = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at                 = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    created_by                 = Column(String(36), ForeignKey("users.id"), nullable=True)
