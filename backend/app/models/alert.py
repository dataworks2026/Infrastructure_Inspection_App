import uuid
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tone            = Column(String(10), nullable=False)           # red|amber
    category        = Column(String(30), nullable=False)           # drone_offline|battery_service|weather|airspace|other
    text            = Column(Text, nullable=False)
    action_label    = Column(String(255), nullable=False)
    action_href     = Column(String(500), nullable=True)

    created_at      = Column(DateTime, server_default=func.now(), nullable=False, index=True)
    acknowledged_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
