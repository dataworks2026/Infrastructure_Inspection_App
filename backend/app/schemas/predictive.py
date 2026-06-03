"""
Pydantic response schemas for the predictive analytics API.

Used by backend/app/routers/predictive.py as response_model on the
five endpoints under /api/v1/predictive. Mirrors the V2 output
schema produced by app.services.analytics.engine — keeping the
API surface and the engine output aligned so the frontend receives
exactly what the pipeline produces.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class PredictiveRunTriggerResponse(BaseModel):
    """Returned by POST /api/v1/predictive/run after a pipeline run."""

    run_id               : str
    status               : str        # 'completed' | 'failed'
    total_items_analyzed : int
    message              : str


class PredictiveRunSummary(BaseModel):
    """Lightweight record for GET /api/v1/predictive/runs listings."""

    id                   : str
    status               : str        # 'running' | 'completed' | 'failed'
    created_at           : datetime
    completed_at         : Optional[datetime] = None
    total_items_analyzed : int
    processing_time_ms   : Optional[int] = None
    engine_version       : str
    schema_version       : str

    class Config:
        from_attributes = True


class SeverityHistoryPoint(BaseModel):
    """One observation in an asset's chronological severity timeline.
    Powers the sparkline on the asset detail page."""

    date     : str       # ISO date 'YYYY-MM-DD'
    severity : int       # 1..4


class PredictiveAnalyticsReason(BaseModel):
    """One contributing factor explaining why an asset got its score.
    Persisted as v1_analytics_reason rows; surfaced on the asset
    detail panel so users can see how priority + TTI add up."""

    reason_code     : str
    reason_category : Optional[str] = None
    reason_text     : str
    weight          : Optional[float] = None
    display_order   : Optional[int]   = None

    class Config:
        from_attributes = True


class PredictiveAssetResult(BaseModel):
    """One asset's full analytics result within a run."""

    asset_id             : str
    asset_name           : str
    asset_type           : Optional[str] = None
    priority_rank        : int
    priority_score       : float
    priority_label       : str                 # Critical|High|Medium|Low|Minimal
    latest_severity      : int                 # 1..4
    trend_direction      : str                 # accelerating|worsening|stable|improving|fluctuating
    severity_change_rate : float               # per year
    acceleration         : bool
    has_anomaly          : bool
    anomaly_reason       : Optional[str] = None
    tti_days             : Optional[float] = None
    tti_label            : str                 # Immediate|Near-term|Medium-term|Long-term|Not applicable
    tti_note             : str
    # Chronological severity timeline used by the asset detail
    # sparkline. Empty list when an asset has no inspections yet
    # or the run was performed before histories were captured.
    severity_history     : List[SeverityHistoryPoint] = []

    # Per-component breakdown of how the score was reached:
    # deterioration, anomaly (if any), tti, current_severity.
    # Empty list when the run pre-dates reason persistence or
    # the item happens to have no reasons attached.
    reasons              : List[PredictiveAnalyticsReason] = []

    # V3 — M2 LightGBM forecast columns.
    # None when the model file is absent (graceful degradation) or
    # when the asset has insufficient inspection history.
    forecast_severity_next : Optional[int] = None   # 1..4
    forecast_confidence    : Optional[str] = None   # High | Medium | Low
    forecast_horizon_days  : Optional[int] = None   # days to next inspection
    forecast_note          : Optional[str] = None   # plain-language summary

    class Config:
        from_attributes = True


class PredictiveRunDetailResponse(PredictiveRunSummary):
    """Full payload for GET /runs/{run_id} and GET /latest.

    Extends PredictiveRunSummary (run metadata) with the ranked
    list of asset results.
    """

    results : List[PredictiveAssetResult]
