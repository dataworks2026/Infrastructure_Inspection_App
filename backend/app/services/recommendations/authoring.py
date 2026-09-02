"""The actual authoring logic: create, edit (new version), archive.

Kept in one place so every future caller -- routers, an admin script, a
vocabulary-baselining tool -- goes through the exact same checks, instead
of a shortcut quietly skipping validation.

Ported from Tahya's Phase-1 service (app/services.py). The only change
beyond org-scoping is DAT-1's vocabulary check and MAT-3's rule-key
collision check, both of which now scope to ``organization_id`` -- two
firms authoring the same rule key independently is not a collision.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.recommendation import RecommendationClassVocabulary, RecommendationLibraryEntry
from app.schemas.recommendation import EntryWrite
from app.services.recommendations.audit import record_audit_event
from app.services.recommendations.errors import FieldValidationError, NotFoundError
from app.services.recommendations.tiers import derive_tier


def _check_tier_override(derived_tier: int, tier_override: Optional[int]) -> None:
    if tier_override is not None and tier_override > derived_tier:
        raise FieldValidationError(
            "tier_override",
            f"cannot be less urgent than the derived tier ({derived_tier}); "
            "an override may only move toward more urgency, never less",
        )


def _check_class_known(db: Session, organization_id: str, detection_class: str) -> None:
    # DAT-1: a rule can only be authored for a class the vocabulary audit
    # has actually observed for THIS organization, never one made up on
    # the spot. The database's own foreign key on
    # recommendation_library_entries.detection_class(-> vocabulary)
    # doesn't exist at the DB level here (composite org+class key), so
    # this check is the sole enforcement -- keep it authoritative.
    exists = db.get(RecommendationClassVocabulary, (organization_id, detection_class))
    if exists is None:
        raise FieldValidationError(
            "detection_class",
            f"'{detection_class}' isn't in this organization's class vocabulary yet; "
            "run the vocabulary audit against a real export first, or get it added "
            "before authoring a rule for it",
        )


def _check_rule_key_collision(
    db: Session,
    organization_id: str,
    data: EntryWrite,
    exclude_entry_id: Optional[str] = None,
) -> None:
    # MAT-3: no two active entries in the same organization can share a
    # rule key. Checked here so the error is a clean field-level one
    # instead of a raw database error; the partial unique index in the
    # d8 migration backs this up independently on both dialects.
    stmt = select(RecommendationLibraryEntry).where(
        RecommendationLibraryEntry.organization_id == organization_id,
        RecommendationLibraryEntry.is_active.is_(True),
        RecommendationLibraryEntry.is_latest.is_(True),
        RecommendationLibraryEntry.detection_class == data.detection_class,
        RecommendationLibraryEntry.severity == data.severity,
        RecommendationLibraryEntry.asset_type == data.asset_type,
        RecommendationLibraryEntry.asset_id == data.asset_id,
    )
    if exclude_entry_id is not None:
        stmt = stmt.where(RecommendationLibraryEntry.entry_id != exclude_entry_id)
    existing = db.execute(stmt).scalar_one_or_none()
    if existing is not None:
        raise FieldValidationError(
            "detection_class",
            f"an active entry already exists with this exact rule key (entry {existing.entry_id})",
        )


def create_entry(db: Session, organization_id: str, data: EntryWrite) -> RecommendationLibraryEntry:
    derived_tier = derive_tier(data.severity)
    _check_tier_override(derived_tier, data.tier_override)
    _check_class_known(db, organization_id, data.detection_class)
    _check_rule_key_collision(db, organization_id, data)

    entry = RecommendationLibraryEntry(
        entry_id=str(uuid4()),
        version=1,
        organization_id=organization_id,
        is_active=True,
        is_latest=True,
        detection_class=data.detection_class,
        severity=data.severity,
        asset_type=data.asset_type,
        asset_id=data.asset_id,
        recommendation_text=data.recommendation_text,
        action_class=data.action_class,
        derived_tier=derived_tier,
        tier_override=data.tier_override,
        created_by=data.actor,
    )
    db.add(entry)
    db.flush()

    record_audit_event(
        db,
        organization_id=organization_id,
        actor=data.actor,
        action="entry_created",
        entity_type="library_entry",
        entity_id=entry.entry_id,
        entity_version=entry.version,
        detail={"detection_class": entry.detection_class, "severity": entry.severity},
    )
    db.commit()
    db.refresh(entry)
    return entry


def _get_latest(db: Session, organization_id: str, entry_id: str) -> Optional[RecommendationLibraryEntry]:
    stmt = select(RecommendationLibraryEntry).where(
        RecommendationLibraryEntry.entry_id == entry_id,
        RecommendationLibraryEntry.organization_id == organization_id,
        RecommendationLibraryEntry.is_latest.is_(True),
    )
    return db.execute(stmt).scalar_one_or_none()


def edit_entry(
    db: Session, organization_id: str, entry_id: str, data: EntryWrite
) -> RecommendationLibraryEntry:
    current = _get_latest(db, organization_id, entry_id)
    if current is None:
        raise NotFoundError(f"no entry found with id {entry_id}")
    if not current.is_active:
        raise FieldValidationError(
            "entry_id", "this entry is archived, so it can't be edited into a new version"
        )

    derived_tier = derive_tier(data.severity)
    _check_tier_override(derived_tier, data.tier_override)
    _check_class_known(db, organization_id, data.detection_class)
    _check_rule_key_collision(db, organization_id, data, exclude_entry_id=entry_id)

    new_version = RecommendationLibraryEntry(
        entry_id=entry_id,
        version=current.version + 1,
        organization_id=organization_id,
        is_active=True,
        is_latest=True,
        detection_class=data.detection_class,
        severity=data.severity,
        asset_type=data.asset_type,
        asset_id=data.asset_id,
        recommendation_text=data.recommendation_text,
        action_class=data.action_class,
        derived_tier=derived_tier,
        tier_override=data.tier_override,
        created_by=data.actor,
    )
    current.is_latest = False
    db.add(new_version)
    db.flush()

    record_audit_event(
        db,
        organization_id=organization_id,
        actor=data.actor,
        action="entry_versioned",
        entity_type="library_entry",
        entity_id=entry_id,
        entity_version=new_version.version,
        detail={"previous_version": current.version},
    )
    db.commit()
    db.refresh(new_version)
    return new_version


def archive_entry(db: Session, organization_id: str, entry_id: str, actor: str) -> dict:
    stmt = select(RecommendationLibraryEntry).where(
        RecommendationLibraryEntry.entry_id == entry_id,
        RecommendationLibraryEntry.organization_id == organization_id,
    )
    versions = db.execute(stmt).scalars().all()
    if not versions:
        raise NotFoundError(f"no entry found with id {entry_id}")

    already_archived = all(not v.is_active for v in versions)
    now = datetime.now(timezone.utc)
    for v in versions:
        if v.is_active:
            v.is_active = False
            v.archived_at = now
    db.flush()

    if not already_archived:
        record_audit_event(
            db,
            organization_id=organization_id,
            actor=actor,
            action="entry_archived",
            entity_type="library_entry",
            entity_id=entry_id,
            detail={"versions_archived": len(versions)},
        )
    db.commit()

    return {
        "entry_id": entry_id,
        "versions_archived": len(versions),
        "archived_at": now,
        "already_archived": already_archived,
    }


def get_entry_history(db: Session, organization_id: str, entry_id: str) -> list[RecommendationLibraryEntry]:
    stmt = (
        select(RecommendationLibraryEntry)
        .where(
            RecommendationLibraryEntry.entry_id == entry_id,
            RecommendationLibraryEntry.organization_id == organization_id,
        )
        .order_by(RecommendationLibraryEntry.version)
    )
    return list(db.execute(stmt).scalars().all())


def list_entries(
    db: Session, organization_id: str, active_only: bool = False, latest_only: bool = True
) -> list[RecommendationLibraryEntry]:
    stmt = select(RecommendationLibraryEntry).where(
        RecommendationLibraryEntry.organization_id == organization_id
    )
    if active_only:
        stmt = stmt.where(RecommendationLibraryEntry.is_active.is_(True))
    if latest_only:
        stmt = stmt.where(RecommendationLibraryEntry.is_latest.is_(True))
    stmt = stmt.order_by(RecommendationLibraryEntry.created_at)
    return list(db.execute(stmt).scalars().all())
