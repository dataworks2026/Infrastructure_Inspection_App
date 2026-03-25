from sqlalchemy import Column, String, Integer, BigInteger, Float, DateTime, ForeignKey, Index
from sqlalchemy import JSON as JSONB
from app.database import Base


class TelemetryPoint(Base):
    __tablename__ = "telemetry_points"

    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    mission_id      = Column(String(36), ForeignKey("missions.id"), nullable=False, index=True)

    timestamp       = Column(DateTime, nullable=False, index=True)
    latitude        = Column(Float, nullable=True)
    longitude       = Column(Float, nullable=True)
    altitude_msl    = Column(Float, nullable=True)
    altitude_agl    = Column(Float, nullable=True)
    heading_deg     = Column(Float, nullable=True)
    pitch_deg       = Column(Float, nullable=True)
    roll_deg        = Column(Float, nullable=True)
    yaw_deg         = Column(Float, nullable=True)
    speed_ms        = Column(Float, nullable=True)
    vertical_speed_ms = Column(Float, nullable=True)

    battery_pct     = Column(Float, nullable=True)
    battery_voltage = Column(Float, nullable=True)
    battery_temp_c  = Column(Float, nullable=True)

    gps_satellites  = Column(Integer, nullable=True)
    gps_fix_type    = Column(String(20), nullable=True)
    signal_strength = Column(Integer, nullable=True)
    flight_mode     = Column(String(50), nullable=True)
    warnings        = Column(JSONB, nullable=True)

    __table_args__ = (
        Index("ix_telemetry_mission_timestamp", "mission_id", "timestamp"),
    )
