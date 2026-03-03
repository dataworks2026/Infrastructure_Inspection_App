from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.database import Base

class Domain(Base):
    __tablename__ = "domains"

    domain_id    = Column(String(50), primary_key=True)
    domain_name  = Column(String(100), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    description  = Column(Text, nullable=True)
    is_active    = Column(Boolean, nullable=False, default=True)
    created_at   = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at   = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
