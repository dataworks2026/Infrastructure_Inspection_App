import uuid
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class Organization(Base):
    __tablename__ = "organizations"

    organization_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name            = Column(String(255), nullable=False)
    slug            = Column(String(100), unique=True, nullable=False)
    subscription_tier = Column(String(50), nullable=True)
    settings        = Column(JSONB, nullable=True, default=dict)
    is_active       = Column(Boolean, nullable=False, default=True)
    created_at      = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
