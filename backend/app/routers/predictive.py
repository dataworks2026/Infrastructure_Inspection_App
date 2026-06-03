"""
FastAPI router exposing the predictive analytics pipeline.

Five endpoints under /api/v1/predictive:

  POST   /run                  trigger a pipeline run for the caller's org
  GET    /runs                 list past runs (newest first)
  GET    /runs/{run_id}        full detail of one run
  GET    /assets/{asset_id}    latest result for a single asset
  GET    /latest               most recent completed run

Every endpoint uses get_current_user and scopes queries by
current_user.organization_id to enforce multi-tenant isolation.

Persistence of run results into the three v1_analytics_* tables
is delegated to app.services.analytics.result_mapper so the
column mapping can be reused and unit-tested without pulling in
the HTTP layer. This router is responsible only for:
  - orchestrating the pipeline (adapter -> engine -> mapper)
  - maintaining the parent V1AnalyticsRun row (status, timings,
    error_message, run_metadata)
  - rehydrating persisted rows into the Pydantic response models
"""

import time
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps                          import get_db, get_current_user
from app.models.user                        import User
from app.models.v1_analytics_run            import V1AnalyticsRun
from app.models.v1_analytics_item           import V1AnalyticsItem
from app.models.v1_analytics_reason         import V1AnalyticsReason
from app.schemas.predictive                 import (
    PredictiveAnalyticsReason,
    PredictiveAssetResult,
    PredictiveRunDetailResponse,
    PredictiveRunSummary,
    PredictiveRunTriggerResponse,
)
from app.services.analytics.data_adapter    import build_analytics_dataframe
from app.services.analytics.engine          import (
    load_config,
    run_pipeline_from_dataframe,
)
from app.services.analytics.result_mapper   import (
    save_analytics_items,
    save_analytics_reasons,
)
from app.services.analytics.utils           import (
    nan_to_none,
    severity_label_to_int,
)

router = APIRouter()

ENGINE_VERSION = "1.0"
SCHEMA_VERSION = "v3"


# ─── read-side helpers ────────────────────────────────────────────────
# Write-side mapping (engine output -> DB rows) now lives in
# app.services.analytics.result_mapper. The helpers below only
# support the GET endpoints that re-hydrate persisted rows into
# Pydantic responses.

def _fetch_reasons_for(
    db    : Session,
    items : List[V1AnalyticsItem],
) -> dict:
    """Batch-fetch all V1AnalyticsReason rows for the given items in
    a single query, returned as {analytics_item_id: [reason, ...]}.
    Avoids N+1 when rendering an entire run's results.
    Each per-item list is sorted by display_order, falling back to
    the row id when display_order is missing.
    """
    if not items:
        return {}
    item_ids = [i.id for i in items]
    rows = (
        db.query(V1AnalyticsReason)
          .filter(V1AnalyticsReason.analytics_item_id.in_(item_ids))
          .all()
    )
    by_item: dict = {}
    for r in rows:
        by_item.setdefault(r.analytics_item_id, []).append(r)
    for item_id, lst in by_item.items():
        lst.sort(key=lambda r: (r.display_order or 99, r.id))
    return by_item


def _reason_row_to_dto(row: V1AnalyticsReason) -> PredictiveAnalyticsReason:
    return PredictiveAnalyticsReason(
        reason_code     = row.reason_code,
        reason_category = row.reason_category,
        reason_text     = row.reason_text or "",
        weight          = row.weight,
        display_order   = row.display_order,
    )


def _item_to_asset_result(
    item    : V1AnalyticsItem,
    reasons : Optional[List[V1AnalyticsReason]] = None,
) -> PredictiveAssetResult:
    """Build a PredictiveAssetResult DTO from a persisted item row.

    The caller may pre-fetch the V1AnalyticsReason rows for this item
    via _fetch_reasons_for and pass them in; when omitted, the
    response's reasons list will be empty (acceptable for older
    runs that pre-date reason persistence).
    """
    meta = item.item_metadata or {}
    latest_severity = severity_label_to_int(item.severity_now) or 0

    # Nullable string fields can come back as NaN (float) from the
    # JSONB column when pandas stored a missing value; coerce those
    # to None so Pydantic Optional[str] validation passes.
    return PredictiveAssetResult(
        asset_id             = item.asset_id,
        asset_name           = nan_to_none(meta.get("asset_name")) or item.asset_id,
        asset_type           = nan_to_none(meta.get("asset_type")),
        priority_rank        = item.priority_rank,
        priority_score       = item.priority_score,
        priority_label       = nan_to_none(meta.get("priority_label")) or "",
        latest_severity      = latest_severity,
        trend_direction      = nan_to_none(meta.get("trend_direction")) or "stable",
        severity_change_rate = item.change_magnitude or 0.0,
        acceleration         = bool(meta.get("acceleration", False)),
        has_anomaly          = bool(meta.get("has_anomaly", False)),
        anomaly_reason       = nan_to_none(meta.get("anomaly_reason")),
        tti_days             = nan_to_none(meta.get("tti_days")),
        tti_label            = nan_to_none(meta.get("tti_label")) or "Not applicable",
        tti_note             = nan_to_none(meta.get("tti_note")) or "",
        # Empty list is the safe default: items written before
        # history capture was added simply lack the field.
        severity_history     = meta.get("severity_history") or [],
        reasons              = [_reason_row_to_dto(r) for r in (reasons or [])],
        # V3 forecast fields — None when model was absent at run time.
        forecast_severity_next = nan_to_none(meta.get("forecast_severity_next")),
        forecast_confidence    = nan_to_none(meta.get("forecast_confidence")),
        forecast_horizon_days  = nan_to_none(meta.get("forecast_horizon_days")),
        forecast_note          = nan_to_none(meta.get("forecast_note")),
    )


def _get_latest_completed_run(
    db              : Session,
    organization_id : str,
) -> Optional[V1AnalyticsRun]:
    """Return the most recent completed run for an org, or None."""
    return (
        db.query(V1AnalyticsRun)
          .filter(V1AnalyticsRun.organization_id == organization_id)
          .filter(V1AnalyticsRun.status          == "completed")
          .order_by(V1AnalyticsRun.created_at.desc())
          .first()
    )


def _build_run_detail_response(
    db  : Session,
    run : V1AnalyticsRun,
) -> PredictiveRunDetailResponse:
    """Hydrate a V1AnalyticsRun and its child items + reasons into the
    response shape. Used by both GET /runs/{id} and GET /latest, which
    only differ in how they look the run up."""
    items = (
        db.query(V1AnalyticsItem)
          .filter(V1AnalyticsItem.analytics_run_id == run.id)
          .order_by(V1AnalyticsItem.priority_rank.asc())
          .all()
    )
    reasons_by_item = _fetch_reasons_for(db, items)

    return PredictiveRunDetailResponse(
        id                   = run.id,
        status               = run.status,
        created_at           = run.created_at,
        completed_at         = run.completed_at,
        total_items_analyzed = run.total_items_analyzed,
        processing_time_ms   = run.processing_time_ms,
        engine_version       = run.engine_version,
        schema_version       = run.schema_version,
        results              = [
            _item_to_asset_result(i, reasons_by_item.get(i.id, []))
            for i in items
        ],
    )


# ─── endpoints ────────────────────────────────────────────────────────

@router.post("/run", response_model=PredictiveRunTriggerResponse)
def trigger_run(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Run the analytics pipeline end-to-end for the caller's org.

    Flow:
      1. Load thresholds.yaml (so weights can be persisted on reasons).
      2. Insert a V1AnalyticsRun row with status='running' up front
         so a mid-pipeline crash still leaves an audit trail.
      3. Build the input DataFrame from the DB.
      4. Run the analytics engine on it.
      5. Persist each output row via result_mapper (items + reasons).
      6. Mark the run completed with timings and run_metadata.
      7. On any exception: mark the run failed and return HTTP 500.
    """

    start  = time.time()
    config = load_config()

    run = V1AnalyticsRun(
        organization_id      = current_user.organization_id,
        status               = "running",
        engine_version       = ENGINE_VERSION,
        schema_version       = SCHEMA_VERSION,
        total_items_analyzed = 0,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        input_df = build_analytics_dataframe(
            db, organization_id=current_user.organization_id
        )
        output_df = run_pipeline_from_dataframe(input_df)

        # Persist results. The mapper returns (item, row) pairs so we
        # can attach reasons without re-iterating the DataFrame.
        saved = save_analytics_items(db, run, output_df, input_df)
        for item, row in saved:
            save_analytics_reasons(db, item, row, config)

        # Describe what ran — handy when comparing runs later.
        asset_types = []
        if len(output_df) > 0:
            asset_types = sorted(
                {str(t) for t in output_df["asset_type"].tolist() if t is not None}
            )

        run.status               = "completed"
        run.completed_at         = datetime.utcnow()
        run.processing_time_ms   = int((time.time() - start) * 1000)
        run.total_items_analyzed = len(output_df)
        run.run_metadata         = {
            "config_file":           "thresholds.yaml",
            "asset_types_analyzed":  asset_types,
            "input_row_count":       int(len(input_df)),
        }
        db.commit()
        db.refresh(run)

        return PredictiveRunTriggerResponse(
            run_id               = run.id,
            status               = run.status,
            total_items_analyzed = run.total_items_analyzed,
            message              = (
                f"Analytics run completed with {run.total_items_analyzed} "
                f"asset(s) analysed."
            ),
        )
    except Exception as exc:
        # Keep the run row so operators can see the failure.
        # Roll back any partial item/reason inserts first so they
        # do not become orphans on a failed run.
        db.rollback()
        run = db.merge(run)
        run.status             = "failed"
        run.completed_at       = datetime.utcnow()
        run.processing_time_ms = int((time.time() - start) * 1000)
        run.error_message      = str(exc)
        db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Analytics run failed: {exc}",
        )


@router.get("/runs", response_model=list[PredictiveRunSummary])
def list_runs(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """List analytics runs for the caller's org, newest first."""
    runs = (
        db.query(V1AnalyticsRun)
          .filter(V1AnalyticsRun.organization_id == current_user.organization_id)
          .order_by(V1AnalyticsRun.created_at.desc())
          .all()
    )
    return runs


@router.get("/runs/{run_id}", response_model=PredictiveRunDetailResponse)
def get_run_detail(
    run_id       : str,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Return full results for a specific run."""
    run = (
        db.query(V1AnalyticsRun)
          .filter(V1AnalyticsRun.id              == run_id)
          .filter(V1AnalyticsRun.organization_id == current_user.organization_id)
          .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _build_run_detail_response(db, run)


@router.get("/latest", response_model=PredictiveRunDetailResponse)
def get_latest_run(
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Return the most recent completed run with its full results."""
    run = _get_latest_completed_run(db, current_user.organization_id)
    if not run:
        raise HTTPException(
            status_code=404,
            detail="No completed analytics runs found for this organization.",
        )
    return _build_run_detail_response(db, run)


@router.get("/assets/{asset_id}", response_model=PredictiveAssetResult)
def get_asset_latest(
    asset_id     : str,
    db           : Session = Depends(get_db),
    current_user : User    = Depends(get_current_user),
):
    """Return the latest analytics result for a single asset,
    pulled from the most recent completed run in the caller's org."""
    run = _get_latest_completed_run(db, current_user.organization_id)
    if not run:
        raise HTTPException(
            status_code=404,
            detail="No analytics available for this asset yet.",
        )

    item = (
        db.query(V1AnalyticsItem)
          .filter(V1AnalyticsItem.analytics_run_id == run.id)
          .filter(V1AnalyticsItem.asset_id         == asset_id)
          .filter(V1AnalyticsItem.organization_id  == current_user.organization_id)
          .first()
    )
    if not item:
        raise HTTPException(
            status_code=404,
            detail="No analytics available for this asset yet.",
        )

    reasons_by_item = _fetch_reasons_for(db, [item])
    return _item_to_asset_result(item, reasons_by_item.get(item.id, []))
