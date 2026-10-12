"""WFL-2 through WFL-5, WFL-8: the actual review step. A record can only
be dispositioned while it's Draft -- Needs Recommendation has nothing to
approve yet, and Approved/Rejected/Superseded are already settled.

Ported from Tahya's Phase-1 service (app/workflow.py), org-scoped
throughout. ``actor`` is no longer a self-reported free-text field --
every caller in the platform passes the authenticated user's identity
(``current_user.email``, the same convention ``detections.reviewed_by``
already uses); this module itself doesn't enforce that, the router layer
does, same separation of concerns as everywhere else in the platform.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.recommendation import RecommendationDetectionLink, RecommendationLibraryEntry, RecommendationRecord
from app.services.recommendations.audit import record_audit_event
from app.services.recommendations.errors import FieldValidationError, NotFoundError

STATUSES = ["Draft", "Approved", "Rejected", "Needs Recommendation", "Superseded"]


def _decision_to_status(decision: str) -> str:
    return "Approved" if decision == "approve" else "Rejected"


def _decision_to_audit_action(decision: str) -> str:
    # not just decision + "d" -- "reject" + "d" is "rejectd", not "rejected"
    return "record_approved" if decision == "approve" else "record_rejected"


def _get_record(db: Session, organization_id: str, record_id: str) -> RecommendationRecord:
    record = db.execute(
        select(RecommendationRecord).where(
            RecommendationRecord.id == record_id, RecommendationRecord.organization_id == organization_id
        )
    ).scalar_one_or_none()
    if record is None:
        raise NotFoundError(f"no record found with id {record_id}")
    return record


def disposition_record(
    db: Session, organization_id: str, record_id: str, decision: str, actor: str
) -> RecommendationRecord:
    record = _get_record(db, organization_id, record_id)
    if record.status != "Draft":
        raise FieldValidationError(
            "status",
            f"only Draft records can be dispositioned; this one is {record.status}",
        )

    record.status = _decision_to_status(decision)
    record.updated_at = datetime.now(timezone.utc)
    db.flush()

    record_audit_event(
        db,
        organization_id=organization_id,
        actor=actor,
        action=_decision_to_audit_action(decision),
        entity_type="recommendation_record",
        entity_id=record.id,
        detail={"previous_status": "Draft"},
    )
    db.commit()
    db.refresh(record)
    return record


def assign_entry(
    db: Session, organization_id: str, record_id: str, entry_id: str, actor: str
) -> RecommendationRecord:
    """WFL-2's other Needs Recommendation -> Draft path: a reviewer picks
    one specific entry for one orphan finding by hand, instead of waiting
    on a rerun to pick it up automatically once a matching rule exists.

    Deliberately doesn't require the entry to actually match the
    detection's class and severity -- if it did, MAT-1/MAT-2 would
    already have caught it during the run and this would have nothing to
    do. This is the manual exception path, not another matching pass.
    """
    record = _get_record(db, organization_id, record_id)
    if record.status != "Needs Recommendation":
        raise FieldValidationError(
            "status",
            f"only a Needs Recommendation record can have an entry assigned to it; this one is {record.status}",
        )

    entry = db.execute(
        select(RecommendationLibraryEntry).where(
            RecommendationLibraryEntry.entry_id == entry_id,
            RecommendationLibraryEntry.organization_id == organization_id,
            RecommendationLibraryEntry.is_latest.is_(True),
        )
    ).scalar_one_or_none()
    if entry is None:
        raise NotFoundError(f"no entry found with id {entry_id}")
    if not entry.is_active:
        raise FieldValidationError("entry_id", "this entry is archived, so it can't be assigned")

    record.matched_entry_id = entry.entry_id
    record.matched_entry_version = entry.version
    record.status = "Draft"
    record.updated_at = datetime.now(timezone.utc)
    db.flush()

    record_audit_event(
        db,
        organization_id=organization_id,
        actor=actor,
        action="record_entry_assigned",
        entity_type="recommendation_record",
        entity_id=record.id,
        entity_version=entry.version,
        detail={"matched_entry_id": str(entry.entry_id), "matched_entry_version": entry.version},
    )
    db.commit()
    db.refresh(record)
    return record


def bulk_disposition(
    db: Session,
    organization_id: str,
    decision: str,
    actor: str,
    record_ids: Optional[list[str]] = None,
    rollup_scope: Optional[str] = None,
    scope_key: Optional[str] = None,
) -> dict:
    # Fixed in the port (Port_Test_Audit.xlsx): her original used
    # `if record_ids:`, which treats an explicit empty list the same as
    # "no ids given" and falls through to the scope branch -- a client
    # bug sending [] would silently mass-approve/reject. An empty list is
    # now rejected outright, and "no filter at all" is no longer a valid
    # way to mean "every Draft org-wide": bulk disposition always needs
    # either explicit ids or a scope filter.
    if record_ids is not None:
        if len(record_ids) == 0:
            raise FieldValidationError(
                "record_ids",
                "an explicit empty list matches nothing; omit record_ids and use "
                "rollup_scope/scope_key instead of passing an empty list",
            )
        candidates = db.execute(
            select(RecommendationRecord).where(
                RecommendationRecord.organization_id == organization_id,
                RecommendationRecord.id.in_(record_ids),
            )
        ).scalars().all()
    else:
        if rollup_scope is None and scope_key is None:
            raise FieldValidationError(
                "record_ids",
                "bulk disposition needs either an explicit list of record ids, or a "
                "rollup_scope/scope_key filter -- there is no 'every Draft record' option",
            )
        stmt = select(RecommendationRecord).where(
            RecommendationRecord.organization_id == organization_id,
            RecommendationRecord.status == "Draft",
        )
        if rollup_scope:
            stmt = stmt.where(RecommendationRecord.rollup_scope == rollup_scope)
        if scope_key:
            stmt = stmt.where(RecommendationRecord.scope_key == scope_key)
        candidates = db.execute(stmt).scalars().all()

    new_status = _decision_to_status(decision)
    now = datetime.now(timezone.utc)
    succeeded: list[str] = []
    skipped: list[dict] = []

    for record in candidates:
        if record.status != "Draft":
            skipped.append({"record_id": str(record.id), "reason": f"not Draft (currently {record.status})"})
            continue
        record.status = new_status
        record.updated_at = now
        db.flush()
        record_audit_event(
            db,
            organization_id=organization_id,
            actor=actor,
            action=_decision_to_audit_action(decision),
            entity_type="recommendation_record",
            entity_id=record.id,
            detail={"previous_status": "Draft", "bulk": True},
        )
        succeeded.append(record.id)

    if record_ids:
        found_ids = {r.id for r in candidates}
        for rid in record_ids:
            if rid not in found_ids:
                skipped.append({"record_id": str(rid), "reason": "not found"})

    db.commit()
    return {"succeeded": succeeded, "skipped": skipped}


def get_record_delta(db: Session, organization_id: str, record_id: str) -> dict:
    record = _get_record(db, organization_id, record_id)
    if record.supersedes_record_id is None:
        raise FieldValidationError(
            "record_id", "this record didn't supersede anything, there's no delta to show"
        )

    new_ids = {
        row[0]
        for row in db.execute(
            select(RecommendationDetectionLink.chain_key).where(
                RecommendationDetectionLink.record_id == record.id
            )
        ).all()
    }
    old_ids = {
        row[0]
        for row in db.execute(
            select(RecommendationDetectionLink.chain_key).where(
                RecommendationDetectionLink.record_id == record.supersedes_record_id
            )
        ).all()
    }

    return {
        "record_id": record.id,
        "supersedes_record_id": record.supersedes_record_id,
        "unchanged_detection_ids": list(old_ids & new_ids),
        "departed_detection_ids": list(old_ids - new_ids),
        # her original delta never reported additions -- a successor that
        # gained a contributor showed an incomplete "what changed" view.
        # fixed in the port (Port_Test_Audit.xlsx, "fixed in port" list).
        "added_detection_ids": list(new_ids - old_ids),
    }


def get_status_summary(db: Session, organization_id: str) -> dict:
    stmt = select(RecommendationRecord.status, RecommendationRecord.id).where(
        RecommendationRecord.organization_id == organization_id
    )
    rows = db.execute(stmt).all()
    counts = {status: 0 for status in STATUSES}
    for status, _ in rows:
        counts[status] += 1
    review_incomplete = counts["Draft"] > 0 or counts["Needs Recommendation"] > 0 or counts["Superseded"] > 0
    return {"counts": counts, "review_incomplete": review_incomplete}


def list_records(
    db: Session,
    organization_id: str,
    status: Optional[str] = None,
    rollup_scope: Optional[str] = None,
    scope_key: Optional[str] = None,
) -> list[RecommendationRecord]:
    stmt = select(RecommendationRecord).where(RecommendationRecord.organization_id == organization_id)
    if status:
        stmt = stmt.where(RecommendationRecord.status == status)
    if rollup_scope:
        stmt = stmt.where(RecommendationRecord.rollup_scope == rollup_scope)
    if scope_key:
        stmt = stmt.where(RecommendationRecord.scope_key == scope_key)
    stmt = stmt.order_by(RecommendationRecord.created_at)
    return list(db.execute(stmt).scalars().all())
