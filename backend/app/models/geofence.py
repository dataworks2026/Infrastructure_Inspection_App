import uuid
from sqlalchemy import Column, String, Float, Text, DateTime
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base


class Geofence(Base):
    __tablename__ = "geofences"

    id          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(255), nullable=False)
    site_id     = Column(String(36), nullable=True)               # opaque ref — no FK until sites table exists
    polygon     = Column(JSONB, nullable=False)                   # [[lng, lat], ...] closed ring
    max_alt_agl = Column(Float, nullable=False)
    no_fly_zones = Column(JSONB, nullable=True)                   # [{name, polygon, activeFrom?, activeUntil?}]
    notes       = Column(Text, nullable=True)

    created_at  = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
