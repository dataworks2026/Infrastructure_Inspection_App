import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class AssetSegment(Base):
    __tablename__ = "asset_segments"

    segment_id       = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id  = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    asset_id         = Column(String(36), ForeignKey("assets.id"), nullable=False)
    segment_code     = Column(String(50), nullable=False)
    segment_name     = Column(String(100), nullable=False)
    segment_category = Column(String(50), nullable=True)
    description      = Column(Text, nullable=True)
    domain_metadata  = Column(JSONB, nullable=True, default=dict)
    created_at       = Column(DateTime, server_default=func.now(), nullable=False)
