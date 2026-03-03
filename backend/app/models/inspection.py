import uuid
from sqlalchemy import Column, String, Integer, Date, DateTime, ForeignKey, Boolean
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class Inspection(Base):
    # Schema doc calls this 'inspection_runs'; kept as 'inspections' for route compat
    __tablename__ = "inspections"

    id                      = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id         = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id                = Column(String(36), ForeignKey("assets.id"), nullable=False)
    domain_id               = Column(String(50), ForeignKey("domains.domain_id"), nullable=True)

    # Schema: inspection_date (DATE); kept inspected_at for compat
    name                    = Column(String(255), nullable=True)
    inspected_at            = Column(DateTime, nullable=True)
    inspection_date         = Column(Date, nullable=True)

    inspector_name          = Column(String(100), nullable=True)
    inspector_certification = Column(String(50), nullable=True)
    inspection_type         = Column(String(50), nullable=True, default="routine")
    inspection_method       = Column(String(50), nullable=True, default="manual")
    inspection_purpose      = Column(String(50), nullable=True)

    triggered_by_risk_id    = Column(String(36), nullable=True)
    equipment_model         = Column(String(100), nullable=True)
    equipment_serial        = Column(String(100), nullable=True)
    environmental_conditions= Column(JSONB, nullable=True, default=dict)

    # legacy field
    weather_conditions      = Column(String, nullable=True)

    total_images            = Column(Integer, nullable=True)
    storage_path            = Column(String(500), nullable=True)

    status                  = Column(String(50), nullable=False, default="pending")
    completed_at            = Column(DateTime, nullable=True)
    user_email              = Column(String(255), nullable=True)
    snapshots               = Column(JSONB, nullable=True, default=dict)

    created_by              = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at              = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at              = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
