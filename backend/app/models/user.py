import uuid
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base

class User(Base):
    __tablename__ = "users"

    # PK kept as 'id' for backward compat with existing routes
    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    username        = Column(String(100), unique=True, nullable=True)
    email           = Column(String(255), unique=True, nullable=False, index=True)
    full_name       = Column(String(255), nullable=True)
    role            = Column(String(50), nullable=False, default="analyst")
    # 'organization' kept for legacy; organization_id is the FK
    organization    = Column(String(255), nullable=True)
    api_key_hash    = Column(String(255), nullable=True)
    hashed_password = Column(String, nullable=False)
    is_active       = Column(Boolean, default=True, nullable=False)
    last_login      = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
