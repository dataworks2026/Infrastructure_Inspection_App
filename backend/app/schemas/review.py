from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, field_validator, model_validator

from app.schemas.detection import BoundingBox


class ReviewAction(str, Enum):
    accepted = "accepted"
    rejected = "rejected"
    modified = "modified"
    added = "added"


class CorrectedDetection(BaseModel):
    damage_type: str
    severity: str
    bbox: BoundingBox
    confidence_score: float = 1.0

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        if v not in ("S1", "S2", "S3", "S4"):
            raise ValueError("severity must be one of S1, S2, S3, S4")
        return v


class DetectionReviewItem(BaseModel):
    cv_detection_id: Optional[str] = None
    action: ReviewAction
    corrected_detection: Optional[CorrectedDetection] = None
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_item(self) -> "DetectionReviewItem":
        if self.action in (ReviewAction.modified, ReviewAction.added) and self.corrected_detection is None:
            raise ValueError(f"corrected_detection is required when action='{self.action.value}'")
        if self.action in (ReviewAction.accepted, ReviewAction.rejected, ReviewAction.modified) and not self.cv_detection_id:
            raise ValueError(f"cv_detection_id is required when action='{self.action.value}'")
        if self.action == ReviewAction.added and self.cv_detection_id is not None:
            raise ValueError("cv_detection_id must be null when action='added'")
        return self


class SubmitReviewRequest(BaseModel):
    reviews: List[DetectionReviewItem]


# ── Responses ─────────────────────────────────────────────────────────────────

class StartReviewResponse(BaseModel):
    inspection_id: str
    status: str
    locked_detections_count: int


class SubmitReviewResponse(BaseModel):
    image_id: str
    reviews_written: int
    cv_accepted: int
    cv_rejected: int
    cv_modified: int
    engineer_added: int


class ReviewSummary(BaseModel):
    total_cv_detections: int
    accepted: int
    rejected: int
    modified: int
    engineer_added: int
    final_verified_count: int
    cv_accuracy_pct: float


class CompleteReviewResponse(BaseModel):
    inspection_id: str
    status: str
    summary: ReviewSummary


class ReviewTotals(BaseModel):
    cv_detections: int
    accepted: int
    rejected: int
    modified: int
    engineer_added: int
    final_count: int
    accuracy_pct: float


class PerImageAction(BaseModel):
    cv_detection_id: Optional[str] = None
    engineer_detection_id: Optional[str] = None
    action: str
    notes: Optional[str] = None


class PerImageDiff(BaseModel):
    image_id: str
    filename: str
    cv_count: int
    final_count: int
    accuracy_pct: float
    actions: List[PerImageAction]


class DamageTypeAccuracy(BaseModel):
    cv: int
    accepted: int
    rejected: int
    modified: int
    pct: float


class ModificationEntry(BaseModel):
    cv_detection_id: Optional[str] = None
    image_filename: Optional[str] = None
    delta: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class ReviewDiffResponse(BaseModel):
    inspection_id: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    totals: ReviewTotals
    per_image: List[PerImageDiff]
    damage_type_accuracy: Dict[str, DamageTypeAccuracy]
    modifications: List[ModificationEntry]
