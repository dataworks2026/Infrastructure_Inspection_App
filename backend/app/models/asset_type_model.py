from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class AssetType(Base):
    __tablename__ = "asset_types"

    asset_type_id   = Column(Integer, primary_key=True, autoincrement=True)
    domain_id       = Column(String(50), ForeignKey("domains.domain_id"), nullable=False)
    type_code       = Column(String(50), nullable=False)
    display_name    = Column(String(100), nullable=False)
    description     = Column(Text, nullable=True)
    parent_type_id  = Column(Integer, ForeignKey("asset_types.asset_type_id"), nullable=True)
    metadata_schema = Column(JSONB, nullable=True)
    created_at      = Column(DateTime, server_default=func.now(), nullable=False)
