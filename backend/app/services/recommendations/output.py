"""OUT-1 through OUT-3. This is the last step: turn whatever's Approved
right now into the actual deliverable. It only ever reads settled
records -- never calls the matcher, never writes anything to the
recommendation tables -- so running it twice against the same unchanged
data gives the same content back (OUT-3).

Ported from Tahya's Phase-1 service (app/output.py), with one behavior
change: her version wrote an ``output_generated`` audit event on every
call, including a plain read -- a GET with a side effect, and every poll
inflated the ledger with an uncorrelatable event (a throwaway random id,
since nothing about a JSON response is persisted). That event moves to
whatever calls this at report/export generation time instead (Stage 4),
where it can carry a real, correlatable ``entity_id`` (the inspection).
build_output itself is now a pure read, matching what OUT-3 actually
claims.
"""

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.recommendation import RecommendationDetectionLink, RecommendationLibraryEntry, RecommendationRecord
from app.services.recommendations import workflow
from app.services.recommendations.tiers import TIER_LABELS


def build_output(db: Session, organization_id: str) -> dict:
    # WFL-6: only Approved records ever render
    stmt = (
        select(RecommendationRecord)
        .where(
            RecommendationRecord.organization_id == organization_id,
            RecommendationRecord.status == "Approved",
        )
        .order_by(RecommendationRecord.created_at, RecommendationRecord.id)
    )
    approved = db.execute(stmt).scalars().all()

    tier_groups: dict[int, list] = defaultdict(list)
    approved_counts_by_tier: dict[int, int] = defaultdict(int)

    for record in approved:
        # read by the pinned identifier and version, never "current" --
        # this is what makes reading the library here legitimate at all
        entry = db.execute(
            select(RecommendationLibraryEntry).where(
                RecommendationLibraryEntry.entry_id == record.matched_entry_id,
                RecommendationLibraryEntry.version == record.matched_entry_version,
                RecommendationLibraryEntry.organization_id == organization_id,
            )
        ).scalar_one_or_none()
        if entry is None:
            # DAT-4's composite FK should make this unreachable; guard
            # anyway rather than let a bad manual data load 500 here.
            continue

        links = db.execute(
            select(RecommendationDetectionLink).where(RecommendationDetectionLink.record_id == record.id)
        ).scalars().all()

        effective_tier = entry.tier_override if entry.tier_override is not None else entry.derived_tier

        tier_groups[effective_tier].append(
            {
                "record_id": record.id,
                "matched_entry_id": record.matched_entry_id,
                "matched_entry_version": record.matched_entry_version,
                "recommendation_text": entry.recommendation_text,
                "action_class": entry.action_class,
                "quantity": len(links),
                "detection_ids": [link.detection_id for link in links],
                "locations": [link.location for link in links if link.location is not None],
            }
        )
        approved_counts_by_tier[effective_tier] += 1

    tiers = [
        {"tier": tier, "label": TIER_LABELS[tier], "recommendations": tier_groups[tier]}
        for tier in sorted(tier_groups.keys())
    ]

    status_counts = workflow.get_status_summary(db, organization_id)["counts"]

    summary = {
        "approved_counts_by_tier": dict(approved_counts_by_tier),
        "needs_recommendation_count": status_counts["Needs Recommendation"],
        "superseded_count": status_counts["Superseded"],
    }

    return {
        "generated_at": datetime.now(timezone.utc),
        "tiers": tiers,
        "summary": summary,
    }
