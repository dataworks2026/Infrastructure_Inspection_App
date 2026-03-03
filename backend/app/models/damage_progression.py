import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Date, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class DamageProgression(Base):
    __tablename__ = "damage_progression"

    progression_id           = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id          = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id                 = Column(String(36), ForeignKey("assets.id"), nullable=False)
    damage_type_id           = Column(Integer, ForeignKey("damage_types.damage_type_id"), nullable=False)

    first_observed_date      = Column(Date, nullable=False)
    last_observed_date       = Column(Date, nullable=False)
    observation_count        = Column(Integer, nullable=False, default=1)

    initial_severity         = Column(String(10), nullable=True)
    current_severity         = Column(String(10), nullable=True)
    severity_change_rate     = Column(Float, nullable=True)     # per month
    trend_direction          = Column(String(20), nullable=True)
    acceleration_detected    = Column(Boolean, nullable=False, default=False)

    damage_location          = Column(JSONB, nullable=True, default=dict)
    damage_migration         = Column(Boolean, nullable=False, default=False)
    affected_area_growth_rate = Column(Float, nullable=True)    # mm²/month
    average_confidence       = Column(Float, nullable=True)
    detection_ids            = Column(JSONB, nullable=True)      # UUID[] stored as JSON array

    created_at               = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at               = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
