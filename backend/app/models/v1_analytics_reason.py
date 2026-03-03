import uuid
from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class V1AnalyticsReason(Base):
    __tablename__ = "v1_analytics_reason"

    id                 = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    analytics_item_id  = Column(String(36), ForeignKey("v1_analytics_item.id"), nullable=False)

    reason_code        = Column(String(50), nullable=False)
    reason_category    = Column(String(50), nullable=True)
    reason_text        = Column(Text, nullable=False)
    weight             = Column(Float, nullable=True)
    confidence         = Column(Float, nullable=True)
    display_order      = Column(Integer, nullable=True)
    evidence           = Column(JSONB, nullable=True, default=dict)

    created_at         = Column(DateTime, server_default=func.now(), nullable=False)
