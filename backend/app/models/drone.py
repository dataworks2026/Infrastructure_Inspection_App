from sqlalchemy import Column, String, Float, Integer, DateTime
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base


class Drone(Base):
    __tablename__ = "drones"

    id                              = Column(String(20), primary_key=True)   # "M350-A"
    name                            = Column(String(255), nullable=False)
    serial                          = Column(String(100), nullable=False, unique=True)
    model                           = Column(String(50), nullable=False)     # M350|M300|M30T|Mavic 3T|Anafi
    fw_version                      = Column(String(50), nullable=True)
    bay                             = Column(String(255), nullable=True)
    status                          = Column(String(30), nullable=False, default="idle")
    current_mission_id              = Column(String(36), nullable=True)      # soft ref — no FK constraint

    # Last-known battery state (persisted for fleet card when drone offline)
    battery_pct                     = Column(Float, nullable=True)
    battery_voltage                 = Column(Float, nullable=True)
    battery_temp_c                  = Column(Float, nullable=True)
    battery_cycles                  = Column(Integer, nullable=True)
    battery_pack                    = Column(String(50), nullable=True)

    # Capabilities stored as JSON arrays/values
    capabilities_lenses             = Column(JSONB, nullable=True)           # ["WIDE","ZOOM","IR","LRF"]
    capabilities_max_flight_time_min = Column(Float, nullable=True)
    capabilities_max_alt_agl        = Column(Float, nullable=True)

    last_seen_at                    = Column(DateTime, nullable=True)
    created_at                      = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at                      = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
