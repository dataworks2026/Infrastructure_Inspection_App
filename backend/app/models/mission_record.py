from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy import JSON as JSONB
from sqlalchemy.sql import func
from app.database import Base


class MissionRecord(Base):
    """Immutable post-flight record. Written once on mission seal; never updated."""
    __tablename__ = "mission_records"

    id                      = Column(String(36), primary_key=True)    # "MR-2026-0428-001"
    plan_snapshot           = Column(JSONB, nullable=False)           # full MissionPlan JSON at arming time
    flown_at_start          = Column(DateTime, nullable=False)
    flown_at_end            = Column(DateTime, nullable=False)
    drone_id                = Column(String(20), ForeignKey("drones.id"), nullable=False)
    pilot_id                = Column(String(36), ForeignKey("pilots.id"), nullable=False)
    mission_id              = Column(String(36), nullable=True)       # soft ref to missions.id

    outcome                 = Column(String(20), nullable=False)      # complete|aborted|land_safe|crash
    reason_if_not_complete  = Column(Text, nullable=True)

    # Stats flattened columns (fast queries, no JSON parse needed for summaries)
    stats_duration_sec      = Column(Integer, nullable=False)
    stats_total_distance_m  = Column(Float, nullable=False)
    stats_max_alt_agl       = Column(Float, nullable=False)
    stats_avg_speed         = Column(Float, nullable=False)
    stats_max_speed         = Column(Float, nullable=False)
    stats_battery_start_pct = Column(Float, nullable=False)
    stats_battery_end_pct   = Column(Float, nullable=False)
    stats_photos_planned    = Column(Integer, nullable=False)
    stats_photos_captured   = Column(Integer, nullable=False)
    stats_data_mb           = Column(Float, nullable=False)
    stats_plan_deviation_max_m = Column(Float, nullable=False)

    telemetry_uri           = Column(String(500), nullable=True)      # s3:// URI when offloaded
    telemetry_inline        = Column(JSONB, nullable=True)            # TelemetrySample[] for small flights
    captures_json           = Column(JSONB, nullable=True)            # CaptureEvent[] metadata
    events_json             = Column(JSONB, nullable=True)            # LogEvent[]

    created_at              = Column(DateTime, server_default=func.now(), nullable=False)
    # No updated_at — immutability enforced at API layer
