"""The recommendations section of the platform inspection report (RPT-02,
RPT-03, RPT-04) through the OI-3 seam: the report builder already takes
optional sections (the engineer review is one), and this is the next one.

Only Approved records render (WFL-6), by tier, with the rule text verbatim
and, per recommendation, the findings it covers by picture and detection.
The run reconciliation of the latest run is carried along so the report
shows the same four buckets the Recommendations page shows (MAT-6).

Pure read: nothing here writes to the recommendation tables. The audit
event for an issued document belongs to the issue path (pdf.py).
"""
from sqlalchemy.orm import Session

from app.models.recommendation import RecommendationRecord, RecommendationReportSnapshot, RecommendationRun
from app.services.recommendations import pdf as rec_pdf
from app.services.recommendations.tiers import TIER_LABELS


def has_approved_recommendations(db: Session, organization_id: str, inspection_id: str) -> bool:
    """Cheap existence check, the same shape as review_diff.has_review_data."""
    return (
        db.query(RecommendationRecord.id)
        .join(RecommendationRun, RecommendationRun.id == RecommendationRecord.run_id)
        .filter(
            RecommendationRecord.organization_id == organization_id,
            RecommendationRecord.status == "Approved",
            RecommendationRun.inspection_id == inspection_id,
        )
        .first()
        is not None
    )


def _finding_ref(row: dict) -> dict:
    link = row["link"]
    return {
        "detection_id": link.detection_id,
        "image_filename": row["filename"],
        "damage_code": row["damage_code"],
        "detection_class": (link.detection_class or "").title(),
        "severity_label": row["severity_label"],
        "confidence": round(float(link.confidence), 2) if link.confidence is not None else None,
    }


def build_report_section(db: Session, organization_id: str, inspection_id: str) -> dict:
    data = rec_pdf._collect(db, organization_id, inspection_id)
    tiers = rec_pdf._tier_labels(db)
    run = rec_pdf._latest_run(db, organization_id, inspection_id)

    approved = [r for r in data["records"] if r.status == "Approved"]
    needs = [r for r in data["records"] if r.status == "Needs Recommendation"]
    superseded = [r for r in data["records"] if r.status == "Superseded"]

    by_tier: dict[int, list] = {}
    for rec in approved:
        entry = data["entries"].get(rec.id)
        tier = entry.tier_override if entry and entry.tier_override is not None else (entry.derived_tier if entry else 3)
        by_tier.setdefault(tier, []).append(rec)

    tier_blocks = []
    for tier in sorted(by_tier):
        recs = []
        for rec in by_tier[tier]:
            entry = data["entries"].get(rec.id)
            rows = rec_pdf._finding_rows(data["links"].get(rec.id, []), data["detections"], data["images"])
            recs.append({
                "record_id": rec.id,
                "recommendation_text": entry.recommendation_text if entry else "",
                "action_class": entry.action_class if entry else "",
                "detection_class": (entry.detection_class if entry else "").title(),
                "rule_id": rec.matched_entry_id,
                "rule_version": rec.matched_entry_version,
                "findings": [_finding_ref(r) for r in rows],
            })
        tier_blocks.append({
            "tier": tier,
            "label": tiers.get(tier, TIER_LABELS.get(tier, "")),
            "recommendations": recs,
        })

    needs_refs = []
    for rec in needs:
        for r in rec_pdf._finding_rows(data["links"].get(rec.id, []), data["detections"], data["images"]):
            needs_refs.append(_finding_ref(r))

    latest = (
        db.query(RecommendationReportSnapshot)
        .filter(
            RecommendationReportSnapshot.organization_id == organization_id,
            RecommendationReportSnapshot.inspection_id == inspection_id,
        )
        .order_by(RecommendationReportSnapshot.generated_at.desc())
        .first()
    )

    return {
        "run": None if run is None else {
            "run_id": run.id,
            "created_at": run.created_at,
            "producer": run.producer,
            "consumed": run.total_detections,
            "matched": run.total_matched,
            "unmatched": run.total_unmatched,
            "dismissed": run.total_dismissed,
            "skipped": run.total_skipped or 0,
        },
        "counts": {
            "approved": len(approved),
            "needs_recommendation": len(needs),
            "superseded": len(superseded),
            "findings_covered": sum(len(t["findings"]) for b in tier_blocks for t in b["recommendations"]),
        },
        "tiers": tier_blocks,
        "needs_recommendation": needs_refs,
        "latest_issued": None if latest is None else {
            "snapshot_id": latest.id,
            "generated_at": latest.generated_at,
            "issued_file_hash": latest.issued_file_hash,
        },
    }
