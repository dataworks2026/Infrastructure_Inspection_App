import uuid
from sqlalchemy import Column, String, Float, Integer, Date, DateTime, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base

class Asset(Base):
    __tablename__ = "assets"

    # PK kept as 'id' for backward compat with existing routes
    id                      = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id         = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    domain_id               = Column(String(50), ForeignKey("domains.domain_id"), nullable=True)
    asset_type_id           = Column(Integer, ForeignKey("asset_types.asset_type_id"), nullable=True)
    asset_code              = Column(String(100), unique=True, nullable=True)

    # 'name' kept for backward compat; asset_name is the schema name
    name                    = Column(String(255), nullable=False)
    asset_subtype           = Column(String(100), nullable=True)
    location_hierarchy      = Column(String, nullable=True)

    # lat/lon kept for backward compat; schema uses gps_lat/gps_lon
    latitude                = Column(Float, nullable=True)
    longitude               = Column(Float, nullable=True)
    gps_accuracy_m          = Column(Float, nullable=True)
    elevation_ft            = Column(Float, nullable=True)
    primary_material_id     = Column(Integer, ForeignKey("materials.material_id"), nullable=True)
    installation_date       = Column(Date, nullable=True)
    last_inspection_date    = Column(Date, nullable=True)

    status                  = Column(String(50), nullable=False, default="active")
    risk_category           = Column(String(20), nullable=True)
    next_inspection_due     = Column(Date, nullable=True)
    inspection_frequency_days = Column(Integer, nullable=True)
    domain_metadata         = Column(JSONB, nullable=True, default=dict)

    # legacy field kept
    infrastructure_type     = Column(String, nullable=True)
    location_name           = Column(String, nullable=True)

    created_by              = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at              = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at              = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
