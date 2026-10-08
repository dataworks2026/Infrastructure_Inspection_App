"""Read-only view of the recommendation engine for the dashboard.

Stage 3 preview: lists what the engine produced (runs, records, approved
output). No writes here; approve/reject land with the role check in Stage 3.
Everything is scoped to the caller's organization.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.inspection import Inspection
from app.models.recommendation import (
    RecommendationClassVocabulary,
    RecommendationDetectionLink,
    RecommendationLibraryEntry,
    RecommendationRun,
    RecommendationVocabulary,
)
from app.models.user import User
from app.services.recommendations import output, workflow

router = APIRouter()

SEVERITY_LABEL = {1: "S1", 2: "S2", 3: "S3", 4: "S4"}


def _tier_labels(db: Session) -> dict:
    rows = [dict(r._mapping) for r in db.execute(text("select * from recommendation_priority_tiers"))]
    labels = {}
    for r in rows:
        label = next((v for k, v in r.items() if k != "tier" and isinstance(v, str)), str(r.get("tier")))
        labels[int(r["tier"])] = label
    return labels


def _inspection_names(db: Session, org: str) -> dict:
    return {i.id: (i.name or i.id[:8]) for i in db.query(Inspection).filter(Inspection.organization_id == org).all()}


@router.get("/recommendations/overview")
def overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    org = current_user.organization_id
    names = _inspection_names(db, org)
    vocabularies = []
    for v in db.execute(select(RecommendationVocabulary)).scalars().all():
        classes = db.execute(
            select(RecommendationClassVocabulary.class_value)
            .where(RecommendationClassVocabulary.vocabulary_id == v.id)
            .order_by(RecommendationClassVocabulary.class_value)
        ).scalars().all()
        vocabularies.append({
            "producer": v.producer, "version": v.version, "status": v.status,
            "hash": v.vocabulary_hash, "weights_sha256": v.weights_sha256,
            "signed_by": v.signed_by, "signed_at": v.signed_at, "classes": list(classes),
        })
    runs = (
        db.query(RecommendationRun)
        .filter(RecommendationRun.organization_id == org)
        .order_by(RecommendationRun.created_at.desc())
        .all()
    )
    active_rules = db.query(RecommendationLibraryEntry).filter(
        RecommendationLibraryEntry.organization_id == org,
        RecommendationLibraryEntry.is_active.is_(True),
        RecommendationLibraryEntry.is_latest.is_(True),
    ).count()
    return {
        "summary": workflow.get_status_summary(db, org),
        "library": {"active_rules": active_rules},
        "vocabularies": vocabularies,
        "tiers": _tier_labels(db),
        "runs": [{
            "id": r.id, "inspection_id": r.inspection_id,
            "inspection_name": names.get(r.inspection_id, r.inspection_id),
            "rollup_scope": r.rollup_scope, "producer": getattr(r, "producer", None),
            "total_detections": r.total_detections, "total_matched": r.total_matched,
            "total_unmatched": r.total_unmatched, "total_dismissed": r.total_dismissed,
            "total_skipped": r.total_skipped, "skipped_manifest": r.skipped_manifest or [],
            "created_at": getattr(r, "created_at", None),
        } for r in runs],
    }


@router.get("/recommendations/records")
def records(
    inspection_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list:
    org = current_user.organization_id
    names = _inspection_names(db, org)
    tiers = _tier_labels(db)
    runs = {r.id: r for r in db.query(RecommendationRun).filter(RecommendationRun.organization_id == org).all()}
    out = []
    for rec in workflow.list_records(db, org):
        run = runs.get(rec.run_id)
        if inspection_id and (run is None or run.inspection_id != inspection_id):
            continue
        links = db.query(RecommendationDetectionLink).filter(RecommendationDetectionLink.record_id == rec.id).all()
        entry = None
        if rec.matched_entry_id:
            entry = db.query(RecommendationLibraryEntry).filter(
                RecommendationLibraryEntry.entry_id == rec.matched_entry_id,
                RecommendationLibraryEntry.version == rec.matched_entry_version,
            ).first()
        sev = sorted({link.severity_at_generation for link in links})
        out.append({
            "id": rec.id, "status": rec.status, "rollup_scope": rec.rollup_scope, "scope_key": rec.scope_key,
            "inspection_id": run.inspection_id if run else None,
            "inspection_name": names.get(run.inspection_id, "") if run else "",
            "detection_class": links[0].detection_class if links else None,
            "severity": [SEVERITY_LABEL.get(s, str(s)) for s in sev],
            "detections": len(links),
            "detection_ids": [link.detection_id for link in links],
            "rule_version": rec.matched_entry_version,
            "tier": entry.derived_tier if entry else None,
            "tier_label": tiers.get(entry.derived_tier) if entry else None,
            "action_class": entry.action_class if entry else None,
            "recommendation_text": entry.recommendation_text if entry else None,
            "supersedes_record_id": rec.supersedes_record_id,
            "updated_at": getattr(rec, "updated_at", None),
        })
    return out


@router.get("/recommendations/output")
def approved_output(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    return output.build_output(db, current_user.organization_id)
