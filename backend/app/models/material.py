from sqlalchemy import Column, String, Integer, DateTime, Text
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base

class Material(Base):
    __tablename__ = "materials"

    material_id      = Column(Integer, primary_key=True, autoincrement=True)
    material_code    = Column(String(50), unique=True, nullable=False)
    display_name     = Column(String(100), nullable=False)
    description      = Column(Text, nullable=True)
    relevant_domains = Column(JSONB, nullable=False)   # TEXT[] stored as JSON array
    created_at       = Column(DateTime, server_default=func.now(), nullable=False)
