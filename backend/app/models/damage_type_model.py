from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class DamageType(Base):
    __tablename__ = "damage_types"

    damage_type_id       = Column(Integer, primary_key=True, autoincrement=True)
    domain_id            = Column(String(50), ForeignKey("domains.domain_id"), nullable=False)
    damage_code          = Column(String(50), nullable=False)
    display_name         = Column(String(100), nullable=False)
    description          = Column(Text, nullable=True)
    applicable_materials = Column(JSONB, nullable=True)   # TEXT[] stored as JSON array
    severity_scale       = Column(String(20), nullable=False)
    created_at           = Column(DateTime, server_default=func.now(), nullable=False)
