"""AUD-1 through AUD-4. Every mutation writes one of these. The table
itself is append-only, enforced by a database trigger (d8 migration,
Postgres only) -- not just by everyone agreeing not to touch it, so it
holds even if something other than this app ever writes to the database.

Ported from Tahya's Phase-1 service (app/audit.py). The only addition is
``organization_id``, since every table in this platform is tenant-scoped
and the audit ledger is no exception -- an event with no organization
would be invisible to every org-scoped query that might need it later.
"""

from datetime import datetime
from typing import Any, Optional, Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.recommendation import RecommendationAuditEvent


def record_audit_event(
    db: Session,
    organization_id: Optional[str],
    actor: str,
    action: str,
    entity_type: str,
    entity_id: Union[str, int],
    entity_version: Optional[int] = None,
    detail: Optional[dict[str, Any]] = None,
) -> RecommendationAuditEvent:
    event = RecommendationAuditEvent(
        organization_id=organization_id,
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        entity_version=entity_version,
        detail=detail,
    )
    db.add(event)
    db.flush()
    return event


def list_audit_events(
    db: Session,
    organization_id: str,
    actor: Optional[str] = None,
    entity_id: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
) -> list[RecommendationAuditEvent]:
    """AUD-3: filterable by actor, entity, and a created_at date range
    (both ends inclusive), stably ordered so a same-second tie always
    resolves the same way. This is query logic, not a mutation, so --
    unlike the rest of this ported package -- it has no Phase-1
    counterpart in app/audit.py; her equivalent lived in the router
    (routers/audit_events.py), which doesn't exist yet (Stage 3). It's
    added here now because it's pure DB-read logic with no HTTP
    dependency, and AUD-3's ported tests need something to call.
    """
    stmt = select(RecommendationAuditEvent).where(RecommendationAuditEvent.organization_id == organization_id)
    if actor is not None:
        stmt = stmt.where(RecommendationAuditEvent.actor == actor)
    if entity_id is not None:
        stmt = stmt.where(RecommendationAuditEvent.entity_id == str(entity_id))
    if start is not None:
        stmt = stmt.where(RecommendationAuditEvent.created_at >= start)
    if end is not None:
        stmt = stmt.where(RecommendationAuditEvent.created_at <= end)
    stmt = stmt.order_by(RecommendationAuditEvent.created_at, RecommendationAuditEvent.id)
    return list(db.execute(stmt).scalars().all())
