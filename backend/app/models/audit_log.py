from sqlalchemy import Column, String, Integer, BigInteger, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class AuditLog(Base):
    __tablename__ = "audit_logs"

    log_id          = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    user_id         = Column(String(36), ForeignKey("users.id"), nullable=True)

    action          = Column(String(100), nullable=False)
    entity_type     = Column(String(50), nullable=False)
    entity_id       = Column(String(100), nullable=True)
    changes         = Column(JSONB, nullable=True, default=dict)
    ip_address      = Column(String(45), nullable=True)    # INET stored as VARCHAR(45)
    user_agent      = Column(Text, nullable=True)

    created_at      = Column(DateTime, server_default=func.now(), nullable=False)
