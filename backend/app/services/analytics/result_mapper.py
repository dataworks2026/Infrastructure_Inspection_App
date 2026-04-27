"""
Persistence mapper for the analytics pipeline.

Takes the engine's V2 output DataFrame and persists it into the
three v1_analytics_* tables. Separated from the router so the
column-by-column mapping logic is testable on its own and the
router stays focused on HTTP concerns.

Two public helpers:

    save_analytics_items(db, run, output_df, input_df)
        Creates one V1AnalyticsItem per asset row in output_df.
        Populates every column the schema supports, including:
          - severity_prev   from input_df (2nd-to-last inspection)
          - days_since_baseline from input_df (date range)
          - damage_type, component  from a single batched DB query
            over detections joined to images

    save_analytics_reasons(db, item, row, config)
        Creates 3-4 V1AnalyticsReason rows per item using the per-
        asset-type weights configured in thresholds.yaml.
"""

from typing import Dict, List, Optional, Tuple

import pandas as pd
from sqlalchemy.orm import Session

from app.models.asset                       import Asset
from app.models.detection                   import Detection
from app.models.image                       import Image
from app.models.inspection                  import Inspection
from app.models.v1_analytics_item           import V1AnalyticsItem
from app.models.v1_analytics_reason         import V1AnalyticsReason
from app.models.v1_analytics_run            import V1AnalyticsRun
from app.services.analytics.utils           import (
    nan_to_none,
    severity_label_to_int,
)


# ─── tiny helpers ────────────────────────────────────────────────────

def _severity_int_to_label(value) -> str:
    """Convert the engine's integer severity (1..4) to the 'S1'..'S4'
    string expected by V1AnalyticsItem.severity_now."""
    try:
        return f"S{int(value)}"
    except (TypeError, ValueError):
        return "S1"


def _trend_to_item_status(trend: Optional[str]) -> str:
    """Map engine trend_direction into the v1_analytics_item.status
    domain (new|persistent|resolved|worsening)."""
    if trend in ("worsening", "accelerating"):
        return "worsening"
    if trend == "improving":
        return "resolved"
    # stable, fluctuating, None all fall through to persistent
    return "persistent"


def _priority_label_to_action(label: Optional[str]) -> str:
    """Map engine priority_label into v1_analytics_item.recommended_action
    domain (monitor|re-inspect|escalate)."""
    if label in ("Critical", "High"):
        return "escalate"
    if label == "Medium":
        return "re-inspect"
    return "monitor"


# ─── derived data helpers ────────────────────────────────────────────

def _compute_severity_prev_and_baseline(
    input_df : pd.DataFrame,
) -> Dict[str, Dict[str, Optional[object]]]:
    """Per-asset, compute two derived values from the raw inspection
    history produced by data_adapter:

      severity_prev      — max severity at the SECOND-TO-LAST inspection.
                           None when the asset has only one inspection.
      days_since_baseline — days from first inspection to latest.
                           None when there is only one inspection.

    Returns a dict keyed by asset_id so the caller can do O(1) lookup
    instead of re-querying the DB for each row.
    """
    result: Dict[str, Dict[str, Optional[object]]] = {}

    if input_df is None or len(input_df) == 0:
        return result

    # Sort newest last so tail(2) gives us (prev, latest) in order.
    for asset_id, group in input_df.groupby("asset_id"):
        ordered = group.sort_values("inspection_date")
        dates   = ordered["inspection_date"].tolist()
        sevs    = ordered["severity_score"].tolist()

        if len(ordered) >= 2:
            severity_prev      = sevs[-2]
            # inspection_date values are python date objects after the
            # adapter's pd.to_datetime(...).dt.date normalisation.
            days_since_baseline = (dates[-1] - dates[0]).days
        else:
            severity_prev       = None
            days_since_baseline = None

        result[asset_id] = {
            "severity_prev"      : severity_prev,
            "days_since_baseline": days_since_baseline,
        }

    return result


def _build_severity_history(
    input_df : pd.DataFrame,
) -> Dict[str, List[Dict[str, object]]]:
    """Per-asset, return the chronological severity timeline as a list
    of {date, severity} dicts. Powers the sparkline on the asset
    detail page without forcing the frontend to make N more API
    calls.

    severity comes out as an integer 1..4 to keep the JSON small;
    the frontend already maps that to S1..S4 colours.
    """
    if input_df is None or len(input_df) == 0:
        return {}

    timeline: Dict[str, List[Dict[str, object]]] = {}
    for asset_id, group in input_df.groupby("asset_id"):
        ordered = group.sort_values("inspection_date")
        points  = []
        for _, row in ordered.iterrows():
            sev_num = severity_label_to_int(row["severity_score"])
            if sev_num is None:
                continue
            d = row["inspection_date"]
            points.append({
                "date":     d.isoformat() if hasattr(d, "isoformat") else str(d),
                "severity": sev_num,
            })
        timeline[asset_id] = points
    return timeline


def _load_latest_detection_fields(
    db              : Session,
    organization_id : Optional[str],
    asset_ids       : List[str],
) -> Dict[str, Dict[str, Optional[str]]]:
    """For each asset, return the damage_type from its most recent
    detection and the component_type from that detection's parent image.

    Single batched query (ORDER BY detected_at DESC); we pick the first
    row seen per asset in Python so this works on SQLite too (no
    DISTINCT ON support).

    NOTE on component:
        ClickUp's Area 4 spec says 'Query most recent detection's
        component'. Detection has no component column, but Image has
        a legacy component_type field — that's used here.
    """
    if not asset_ids:
        return {}

    query = (
        db.query(
            Asset.id.label("asset_id"),
            Detection.damage_type,
            Image.component_type.label("component"),
            Detection.detected_at,
        )
        .join(Inspection, Inspection.asset_id == Asset.id)
        .join(Image,      Image.inspection_id == Inspection.id)
        .join(Detection,  Detection.image_id  == Image.id)
        .filter(Asset.id.in_(asset_ids))
        .order_by(Detection.detected_at.desc())
    )
    if organization_id is not None:
        query = query.filter(Asset.organization_id == organization_id)

    per_asset: Dict[str, Dict[str, Optional[str]]] = {}
    for asset_id, damage_type, component, _detected_at in query.all():
        if asset_id in per_asset:
            continue
        per_asset[asset_id] = {
            "damage_type": damage_type,
            "component"  : component,
        }

    return per_asset


# ─── public API ──────────────────────────────────────────────────────

def save_analytics_items(
    db        : Session,
    run       : V1AnalyticsRun,
    output_df : pd.DataFrame,
    input_df  : pd.DataFrame,
) -> List[Tuple[V1AnalyticsItem, pd.Series]]:
    """Persist one V1AnalyticsItem per row of output_df.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy session. The caller controls the
        transaction boundary (commit / rollback).
    run : V1AnalyticsRun
        The already-persisted parent run. ``run.id`` is used as
        ``analytics_run_id`` on every item.
    output_df : pd.DataFrame
        Engine V2 output — one row per asset.
    input_df : pd.DataFrame
        The DataFrame produced by data_adapter.build_analytics_dataframe
        for the same org/run. Used to derive severity_prev and
        days_since_baseline without additional DB trips.

    Returns
    -------
    list[tuple[V1AnalyticsItem, pd.Series]]
        Pairs of the newly-created item and its source row. Returned
        so the reason-saving helper (Subtask 4.2) can attach reasons
        to each item without recomputing anything.
    """

    if output_df is None or len(output_df) == 0:
        return []

    # One-time lookups so the per-row body is O(1).
    derived         = _compute_severity_prev_and_baseline(input_df)
    history_by_id   = _build_severity_history(input_df)
    asset_ids       = output_df["asset_id"].tolist()
    detection_map   = _load_latest_detection_fields(
        db, run.organization_id, asset_ids
    )

    items: List[Tuple[V1AnalyticsItem, pd.Series]] = []

    for _, row in output_df.iterrows():
        asset_id     = row["asset_id"]
        d            = derived.get(asset_id, {})
        latest_det   = detection_map.get(asset_id, {})
        # severity_prev comes from data_adapter (input_df) and is
        # already in the canonical "S1".."S4" string form, so it is
        # stored directly. severity_now comes from the engine output
        # where severity is an integer 1..4 and must be reformatted.
        sev_prev_raw = d.get("severity_prev")

        item = V1AnalyticsItem(
            analytics_run_id    = run.id,
            organization_id     = run.organization_id,
            asset_id            = asset_id,
            segment_id          = None,
            defect_id           = None,
            status              = _trend_to_item_status(row.get("trend_direction")),
            severity_prev       = sev_prev_raw if sev_prev_raw is not None else None,
            severity_now        = _severity_int_to_label(row["latest_severity"]),
            priority_score      = float(row["priority_score"]),
            priority_rank       = int(row["priority_rank"]),
            recommended_action  = _priority_label_to_action(row.get("priority_label")),
            change_magnitude    = (
                float(row["severity_change_rate"])
                if row.get("severity_change_rate") is not None else None
            ),
            days_since_baseline = d.get("days_since_baseline"),
            damage_type         = latest_det.get("damage_type"),
            component           = latest_det.get("component"),
            location_description = None,
            # Every nullable string field is passed through nan_to_none
            # because pandas represents missing strings as NaN (float),
            # and NaN is not a valid JSONB or Pydantic Optional[str]
            # value on the read path.
            item_metadata       = {
                "asset_name":       nan_to_none(row.get("asset_name")),
                "asset_type":       nan_to_none(row.get("asset_type")),
                "priority_label":   nan_to_none(row.get("priority_label")),
                "trend_direction":  nan_to_none(row.get("trend_direction")),
                "acceleration":     bool(row.get("acceleration", False)),
                "has_anomaly":      bool(row.get("has_anomaly", False)),
                "anomaly_reason":   nan_to_none(row.get("anomaly_reason")),
                "tti_days":         nan_to_none(row.get("tti_days")),
                "tti_label":        nan_to_none(row.get("tti_label")),
                "tti_note":         nan_to_none(row.get("tti_note")),
                # Chronological severity points so the asset detail
                # sparkline does not need extra DB roundtrips.
                "severity_history": history_by_id.get(asset_id, []),
            },
        )
        db.add(item)
        db.flush()    # populate item.id so the reason helper can FK to it
        items.append((item, row))

    return items


def save_analytics_reasons(
    db     : Session,
    item   : V1AnalyticsItem,
    row    : pd.Series,
    config : dict,
) -> List[V1AnalyticsReason]:
    """Persist 3 or 4 V1AnalyticsReason rows explaining one item's score.

    Rows created (per ClickUp Area 4 mapping):

      1. Deterioration     (always)   weight = deterioration_rate
      2. Anomaly           (if flag)  weight = anomaly_flag
      3. TTI               (always)   weight = NULL (informational)
      4. Current Severity  (always)   weight = current_severity

    Weights are looked up from thresholds.yaml by the item's asset_type,
    falling back to the 'default' block when the asset type is missing
    or unknown — same resolution path the engine uses internally.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy session. The caller controls commit/rollback.
    item : V1AnalyticsItem
        Already-persisted item whose id is used as analytics_item_id.
    row : pd.Series
        The engine V2 output row for this item (same row passed back
        from save_analytics_items so fields line up exactly).
    config : dict
        Parsed thresholds.yaml (already loaded by the caller).

    Returns
    -------
    list[V1AnalyticsReason]
        The newly added reason rows, in display order.
    """

    # Weight lookup — identical resolution path to the engine so what
    # the DB records and what the engine used are the same value.
    asset_type   = row.get("asset_type")
    asset_config = (config or {}).get(asset_type) or (config or {}).get("default") or {}
    weights      = asset_config.get("priority_weights", {}) or {}

    w_deterioration = weights.get("deterioration_rate")
    w_anomaly       = weights.get("anomaly_flag")
    w_severity      = weights.get("current_severity")

    # Canonical values for the reason texts.
    severity_change_rate = row.get("severity_change_rate")
    trend_direction      = row.get("trend_direction", "stable")
    priority_label       = row.get("priority_label", "")
    latest_severity      = row.get("latest_severity")
    has_anomaly          = bool(row.get("has_anomaly", False))
    anomaly_reason_text  = row.get("anomaly_reason")
    tti_note             = row.get("tti_note") or ""

    reasons: List[V1AnalyticsReason] = []

    # 1. Deterioration — always present.
    rate_display = (
        f"{float(severity_change_rate):.4f}"
        if severity_change_rate is not None else "0.0000"
    )
    reasons.append(V1AnalyticsReason(
        analytics_item_id = item.id,
        reason_code       = "deterioration",
        reason_category   = "trend",
        reason_text       = (
            f"Severity changing at {rate_display}/year — trend: {trend_direction}"
        ),
        weight            = w_deterioration,
        display_order     = 1,
    ))

    # 2. Anomaly — only when the engine flagged a jump.
    if has_anomaly:
        reasons.append(V1AnalyticsReason(
            analytics_item_id = item.id,
            reason_code       = "anomaly",
            reason_category   = "anomaly",
            reason_text       = anomaly_reason_text or "Anomalous severity jump detected.",
            weight            = w_anomaly,
            display_order     = 2,
        ))

    # 3. TTI — always present; the note explains the verdict even for
    # assets marked "Not applicable".
    reasons.append(V1AnalyticsReason(
        analytics_item_id = item.id,
        reason_code       = "tti",
        reason_category   = "projection",
        reason_text       = tti_note,
        weight            = None,   # TTI does not contribute to the score
        display_order     = 3,
    ))

    # 4. Current severity — always present; gives a human summary of
    # where the asset is right now.
    sev_label = (
        f"S{int(latest_severity)}"
        if latest_severity is not None else "unknown"
    )
    reasons.append(V1AnalyticsReason(
        analytics_item_id = item.id,
        reason_code       = "current_severity",
        reason_category   = "severity",
        reason_text       = (
            f"Current severity: {sev_label} — priority label: {priority_label}"
        ),
        weight            = w_severity,
        display_order     = 4,
    ))

    for r in reasons:
        db.add(r)

    return reasons
