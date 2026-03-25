import uuid
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Boolean
from app.database import Base


class MissionWaypoint(Base):
    __tablename__ = "mission_waypoints"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    mission_id      = Column(String(36), ForeignKey("missions.id"), nullable=False)

    sequence_index  = Column(Integer, nullable=False)
    latitude        = Column(Float, nullable=False)
    longitude       = Column(Float, nullable=False)
    altitude_m      = Column(Float, nullable=False)
    speed_ms        = Column(Float, nullable=True)
    gimbal_pitch    = Column(Float, nullable=True)
    gimbal_yaw      = Column(Float, nullable=True)
    heading_deg     = Column(Float, nullable=True)
    action          = Column(String(50), nullable=False, default="photo_all")
    hover_time_s    = Column(Float, nullable=True)

    reached_at      = Column(DateTime, nullable=True)
    photo_taken     = Column(Boolean, nullable=False, default=False)
    image_id        = Column(String(36), ForeignKey("images.id"), nullable=True)
