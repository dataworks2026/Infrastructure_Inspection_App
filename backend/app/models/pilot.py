import uuid
from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class Pilot(Base):
    __tablename__ = "pilots"

    id                      = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id                 = Column(String(36), ForeignKey("users.id"), nullable=True, unique=True)

    name                    = Column(String(255), nullable=False)
    initials                = Column(String(10), nullable=False)
    email                   = Column(String(255), nullable=False, index=True)

    license_kind            = Column(String(20), nullable=False)   # Part107|EASA_A1A3|EASA_A2|other
    license_number          = Column(String(100), nullable=False)
    license_expires_at      = Column(DateTime, nullable=False)

    insurance_carrier       = Column(String(255), nullable=True)
    insurance_coverage_usd  = Column(Float, nullable=True)
    insurance_active_until  = Column(DateTime, nullable=True)

    role                    = Column(String(20), nullable=False, default="pilot")  # pilot|dispatcher|admin
    active                  = Column(Boolean, nullable=False, default=True)

    created_at              = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at              = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
