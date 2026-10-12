"""Stage 4 write-through: approved recommendation records projected into the
platform's maintenance_recommendations table (Rev B section 2 and 8.3).

The library keeps its three OI-4 tiers; the platform's five-value priority
ladder is a projection concern, mapped here and nowhere else:
tier 1 -> immediate, tier 2 -> scheduled, tier 3 -> monitor. 'urgent' and
'defer' are not produced by the projection.

One maintenance row per approved record, carrying the record id in
alternative_options so a supersede can find and mark it. The engine's own
tables stay the source of truth; this table is what the rest of the
platform already reads.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.inspection import Inspection
from app.models.maintenance_recommendation import MaintenanceRecommendation
from app.models.recommendation import RecommendationLibraryEntry, RecommendationRecord, RecommendationRun

TIER_TO_PRIORITY = {1: "immediate", 2: "scheduled", 3: "monitor"}
SOURCE = "recommendation_engine"


def _asset_for(db: Session, record: RecommendationRecord) -> Optional[str]:
    run = db.query(RecommendationRun).filter(RecommendationRun.id == record.run_id).first()
    if run is None or not run.inspection_id:
        return None
    insp = db.query(Inspection).filter(Inspection.id == run.inspection_id).first()
    return insp.asset_id if insp else None


def _find_projection(db: Session, record_id: str) -> Optional[MaintenanceRecommendation]:
    rows = db.query(MaintenanceRecommendation).filter(
        MaintenanceRecommendation.recommendation_type == SOURCE
    ).all()
    for row in rows:
        opts = row.alternative_options or {}
        if isinstance(opts, dict) and opts.get("record_id") == record_id:
            return row
    return None


def project_approved(db: Session, record: RecommendationRecord, actor_user_id: Optional[str]) -> Optional[MaintenanceRecommendation]:
    """Create (or refresh) the maintenance row for an Approved record. Returns
    None when the record has no asset to hang the row on."""
    if record.status != "Approved" or not record.matched_entry_id:
        return None
    asset_id = _asset_for(db, record)
    if asset_id is None:
        return None
    entry = db.query(RecommendationLibraryEntry).filter(
        RecommendationLibraryEntry.entry_id == record.matched_entry_id,
        RecommendationLibraryEntry.version == record.matched_entry_version,
    ).first()
    if entry is None:
        return None
    now = datetime.now(timezone.utc)
    row = _find_projection(db, record.id)
    if row is None:
        row = MaintenanceRecommendation(
            organization_id=record.organization_id, asset_id=asset_id,
            recommendation_type=SOURCE, created_by=actor_user_id,
        )
        db.add(row)
    row.priority = TIER_TO_PRIORITY.get(entry.derived_tier, "monitor")
    row.description = entry.recommendation_text
    row.justification = (
        f"Engineer approved recommendation record {record.id}, library rule {entry.entry_id} v{entry.version} "
        f"({entry.detection_class}, severity {entry.severity})."
    )
    row.alternative_options = {"source": SOURCE, "record_id": record.id, "entry_id": entry.entry_id,
                               "entry_version": entry.version, "action_class": entry.action_class}
    row.status = "approved"
    row.approved_by = actor_user_id
    row.approved_at = now
    db.flush()
    return row


def mark_superseded(db: Session, record_ids: list[str]) -> int:
    """Projected rows for records that got superseded stop being 'approved'."""
    n = 0
    for rid in record_ids:
        row = _find_projection(db, rid)
        if row is not None and row.status != "superseded":
            row.status = "superseded"
            n += 1
    if n:
        db.flush()
    return n
