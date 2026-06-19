import re
from enum import Enum
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from pydantic import BaseModel, field_validator, model_validator

from app.schemas.detection import BoundingBox

# ── Annotation App reference vocabularies (must match exactly) ────────────────

# Global structural segment codes
STRUCTURAL_SEGMENT_CODES = {
    "DT", "DU", "CP", "PT", "PS", "SZ", "FD", "BH", "SS", "AR", "AP", "BP",
}

# Damage type codes (flat union across domains)
DAMAGE_CODES = {
    "CR", "SP", "CO", "LO", "DE", "BG", "CF", "ER", "SC", "MG",
    "WR", "DF", "BK", "MS", "AL", "LT", "IC", "DL", "IM", "OL",
}

DEFECT_ID_RE = re.compile(r"^[A-Z0-9-]+$")


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
    # Annotation-label fields (all optional; mirror the Annotation App model)
    damage_code: Optional[str] = None
    structural_segments: Optional[List[str]] = None
    defect_id: Optional[str] = None
    shape_type: Literal["rect", "ellipse"] = "rect"

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        if v not in ("S1", "S2", "S3", "S4"):
            raise ValueError("severity must be one of S1, S2, S3, S4")
        return v

    @field_validator("damage_code")
    @classmethod
    def validate_damage_code(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in DAMAGE_CODES:
            raise ValueError(f"damage_code must be one of: {', '.join(sorted(DAMAGE_CODES))}")
        return v

    @field_validator("structural_segments")
    @classmethod
    def validate_structural_segments(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        # None/empty is allowed — the frontend enforces "at least one" advisory
        if v:
            for code in v:
                if code not in STRUCTURAL_SEGMENT_CODES:
                    raise ValueError(
                        f"invalid structural segment code '{code}' — must be one of: "
                        f"{', '.join(sorted(STRUCTURAL_SEGMENT_CODES))}"
                    )
        return v

    @field_validator("defect_id")
    @classmethod
    def validate_defect_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.upper()  # coerce before regex, matching the annotation app
        if len(v) > 50:
            raise ValueError("defect_id must be at most 50 characters")
        if not DEFECT_ID_RE.match(v):
            raise ValueError("defect_id must match ^[A-Z0-9-]+$")
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


# Image asset_type values (flat union across domains)
ASSET_TYPES = {
    "pier", "bulkhead", "seawall", "wharf", "dock",
    "bridge", "retaining_wall", "track", "tunnel", "station", "signal",
    "turbine", "foundation", "blade", "nacelle", "tower", "other",
}


class UpdateAssetTypeRequest(BaseModel):
    asset_type: str

    @field_validator("asset_type")
    @classmethod
    def validate_asset_type(cls, v: str) -> str:
        if v not in ASSET_TYPES:
            raise ValueError(f"asset_type must be one of: {', '.join(sorted(ASSET_TYPES))}")
        return v


class UpdateAssetTypeResponse(BaseModel):
    image_id: str
    asset_type: str


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


class OverallReviewStats(BaseModel):
    reviewed_inspections: int
    total_cv_detections: int
    accepted: int
    rejected: int
    modified: int
    engineer_added: int
    avg_accuracy_pct: float


class RecentReviewedInspection(BaseModel):
    inspection_id: str
    name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    accuracy_pct: float
    cv_detections: int


class ReviewStatsResponse(BaseModel):
    overall: OverallReviewStats
    by_damage_type: Dict[str, DamageTypeAccuracy]
    recent: List[RecentReviewedInspection]


class ReopenImageReviewResponse(BaseModel):
    image_id: str
    inspection_id: str
    status: str
    cleared_reviews: int
    removed_engineer_detections: int
    reset_cv_detections: int


class ReopenInspectionReviewResponse(BaseModel):
    inspection_id: str
    status: str
    cleared_reviews: int
    removed_engineer_detections: int
    reset_cv_detections: int


class ReviewDiffResponse(BaseModel):
    inspection_id: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    totals: ReviewTotals
    per_image: List[PerImageDiff]
    damage_type_accuracy: Dict[str, DamageTypeAccuracy]
    modifications: List[ModificationEntry]
