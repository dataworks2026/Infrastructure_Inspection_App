import uuid
from sqlalchemy import Column, String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base


class FlightLog(Base):
    __tablename__ = "flight_logs"

    id                  = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    mission_id          = Column(String(36), ForeignKey("missions.id"), nullable=False)
    organization_id     = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    pilot_id            = Column(String(36), ForeignKey("users.id"), nullable=True)

    pilot_certificate   = Column(String(100), nullable=True)
    flight_date         = Column(Date, nullable=True)
    takeoff_time        = Column(DateTime, nullable=True)
    landing_time        = Column(DateTime, nullable=True)
    flight_duration_s   = Column(Integer, nullable=True)

    takeoff_location    = Column(JSONB, nullable=True)
    landing_location    = Column(JSONB, nullable=True)

    max_altitude_agl_m  = Column(Float, nullable=True)
    max_distance_m      = Column(Float, nullable=True)
    max_speed_ms        = Column(Float, nullable=True)

    weather_conditions  = Column(JSONB, nullable=True)
    incidents           = Column(JSONB, nullable=True)
    notes               = Column(Text, nullable=True)

    laanc_status        = Column(String(50), nullable=True)
    airspace_class      = Column(String(10), nullable=True)
    preflight_checklist = Column(JSONB, nullable=True)

    created_at          = Column(DateTime, server_default=func.now(), nullable=False)
