import uuid
from sqlalchemy import Column, String, Integer, BigInteger, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base

class Image(Base):
    __tablename__ = "images"

    id                  = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id     = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True)
    inspection_id       = Column(String(36), ForeignKey("inspections.id"), nullable=False)

    filename            = Column(String(255), nullable=False)
    original_filename   = Column(String(255), nullable=True)
    stored_path         = Column(String(500), nullable=True)   # local storage path (legacy)
    raw_path            = Column(String(500), nullable=True)   # deprecated; use s3_key
    thumbnail_path      = Column(String(500), nullable=True)
    labeled_path        = Column(String(500), nullable=True)   # deprecated; use s3_key_annotated
    s3_bucket           = Column(String(255), nullable=False, default="infrastructure-marking-images")
    s3_key              = Column(String(500), nullable=True)
    s3_key_version      = Column(String(10), nullable=True)
    s3_key_annotated    = Column(String(500), nullable=True)
    upload_completed    = Column(Boolean, nullable=False, default=False)

    capture_datetime    = Column(DateTime, nullable=True)
    capture_timestamp   = Column(DateTime, nullable=True)   # legacy alias
    gps_lat             = Column(Float, nullable=True)
    gps_lon             = Column(Float, nullable=True)
    gps_accuracy_m      = Column(Float, nullable=True)
    distance_to_subject_ft = Column(Float, nullable=True)

    imagery_type        = Column(String(50), nullable=True)
    file_size_bytes     = Column(BigInteger, nullable=True)
    image_quality_score = Column(Float, nullable=True)
    blur_detected       = Column(Boolean, nullable=False, default=False)
    glare_detected      = Column(Boolean, nullable=False, default=False)
    content_type        = Column(String(50), nullable=True)

    analysis_status     = Column(String(50), nullable=False, default="queued")

    annotation_status   = Column(String(20), nullable=False, default="not_started")
    num_annotations     = Column(Integer, nullable=False, default=0)

    domain_metadata     = Column(JSONB, nullable=True, default=dict)
    component_type      = Column(String, nullable=True)   # legacy field

    deleted_at          = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, server_default=func.now(), nullable=False)
