"""Ties the matcher together into an actual run: resolve every detection,
group the matches (MAT-7/8), record what happened (MAT-6, extended), and
persist records that pin exactly what they matched against (MAT-9).

The matching itself is a pure function of what comes in, so running the
same detections against the same library twice produces the same groups
every time (MAT-4). Nothing here is random or depends on wall clock time
for anything except the created_at stamp.

Ported from Tahya's Phase-1 service (app/engine.py). Three things differ
from her original, all at points baseline §8.3 calls out explicitly:

1. Identity is keyed on ``chain_key``, not the row id that backs a
   detection. A 'modified' review swaps the backing row (the engineer's
   corrected detection replaces the CV one) while the *finding* is the
   same thing being tracked -- chain_key is what stays constant across
   that swap, which is exactly what lets MAT-11's severity comparison
   fire unchanged on a real platform correction instead of seeing an
   unrelated "new detection".

2. Reconciliation carries a fourth term. Tahya's MAT-6 was
   matched + unmatched + dismissed == total; Matteo's Reconciliation 3
   extends it with skipped rows (null/invalid severity, unscopable) so
   nothing --  not even a data-quality problem -- disappears from the
   count silently.

3. The dispositioned-record "did anything change" check is widened.
   Her original only compared severity on a detection id still present
   in the refresh, which misses two real cases: a detection that
   vanishes from the corpus entirely (an image re-analyzed out from
   under an approved record), and a contributor whose review verdict
   flips to rejected *after* approval (dismissal is not a severity
   change, so her version never caught it). Both now count as changed
   and route through the same supersede path a severity correction
   does -- rather than leaving a stale approved record quietly
   pointing at data that no longer backs it.

rerun_resolution (MAT-11) still assumes each call gets the full current
detection set for the inspection, not just what changed -- the platform's
own review-completion/reopen lifecycle already guarantees that.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.recommendation import (
    RecommendationDetectionLink,
    RecommendationLibraryEntry,
    RecommendationRecord,
    RecommendationRun,
)
from app.services.recommendations.audit import record_audit_event
from app.services.recommendations.matching import resolve_detection
from app.services.recommendations.types import MatchableDetection

ROLLUP_SCOPES = ("image", "asset", "inspection")


def _location_dict(detection: MatchableDetection) -> Optional[dict]:
    return detection.location


def _scope_key(detection: MatchableDetection, rollup_scope: str) -> str:
    if rollup_scope == "image":
        return str(detection.image_id)
    if rollup_scope == "asset":
        return str(detection.asset_id)
    return str(detection.inspection_id)


def _classify(
    detections: list[MatchableDetection],
) -> tuple[list[MatchableDetection], list[MatchableDetection], list[MatchableDetection]]:
    """Partition a full detection feed into (eligible, dismissed, skipped).
    Reconciliation 3: every detection lands in exactly one bucket below,
    or in the fourth ("matched"/"unmatched", determined later) -- never
    silently dropped.
    """
    skipped = [d for d in detections if d.skip_reason is not None]
    dismissed = [d for d in detections if d.skip_reason is None and d.dismissed]
    eligible = [d for d in detections if d.skip_reason is None and not d.dismissed]
    return eligible, dismissed, skipped


def _skipped_manifest(skipped: list[MatchableDetection]) -> list[dict]:
    return [{"detection_id": d.id, "reason": d.skip_reason} for d in skipped]


def _load_active_entries(db: Session, organization_id: str) -> list[RecommendationLibraryEntry]:
    stmt = select(RecommendationLibraryEntry).where(
        RecommendationLibraryEntry.organization_id == organization_id,
        RecommendationLibraryEntry.is_active.is_(True),
        RecommendationLibraryEntry.is_latest.is_(True),
    )
    return list(db.execute(stmt).scalars().all())


def preview_matches(db: Session, organization_id: str, detections: list[MatchableDetection]) -> list[dict]:
    """Read only: what each detection would match against the library right
    now, without persisting anything. Same pure resolve_detection call a
    real run uses (MAT-4), just never written down.
    """
    entries = _load_active_entries(db, organization_id)
    results = []
    for detection in detections:
        if detection.skip_reason is not None:
            results.append({
                "detection_id": detection.id, "matched": False, "dismissed": False,
                "skipped": True, "skip_reason": detection.skip_reason,
                "recommendation_text": None, "action_class": None, "tier": None,
            })
            continue
        if detection.dismissed:
            results.append({
                "detection_id": detection.id, "matched": False, "dismissed": True,
                "skipped": False, "skip_reason": None,
                "recommendation_text": None, "action_class": None, "tier": None,
            })
            continue
        entry = resolve_detection(entries, detection)
        if entry is None:
            results.append({
                "detection_id": detection.id, "matched": False, "dismissed": False,
                "skipped": False, "skip_reason": None,
                "recommendation_text": None, "action_class": None, "tier": None,
            })
        else:
            tier = entry.tier_override if entry.tier_override is not None else entry.derived_tier
            results.append({
                "detection_id": detection.id, "matched": True, "dismissed": False,
                "skipped": False, "skip_reason": None,
                "recommendation_text": entry.recommendation_text, "action_class": entry.action_class, "tier": tier,
            })
    return results


def _resolve_and_group(
    entries: list[RecommendationLibraryEntry], detections: list[MatchableDetection], rollup_scope: str
) -> tuple[dict, list[MatchableDetection]]:
    """The actual matching + consolidation pass (MAT-1, MAT-2, MAT-7, MAT-8).
    Shared by both a first run and a rerun -- the logic is identical, only
    which detections go in differs.
    """
    groups: dict[tuple, list[MatchableDetection]] = defaultdict(list)
    unmatched: list[MatchableDetection] = []

    for detection in detections:
        entry = resolve_detection(entries, detection)
        if entry is None:
            unmatched.append(detection)
        else:
            key = (entry.entry_id, entry.version, _scope_key(detection, rollup_scope))
            groups[key].append(detection)

    return groups, unmatched


def _persist_groups(
    db: Session,
    organization_id: str,
    run_id: str,
    groups: dict,
    unmatched: list[MatchableDetection],
    rollup_scope: str,
) -> list[RecommendationRecord]:
    created: list[RecommendationRecord] = []

    for (entry_id, entry_version, scope_key), contributing in groups.items():
        record = RecommendationRecord(
            id=str(uuid4()),
            organization_id=organization_id,
            status="Draft",
            matched_entry_id=entry_id,
            matched_entry_version=entry_version,
            rollup_scope=rollup_scope,
            scope_key=scope_key,
            run_id=run_id,
        )
        db.add(record)
        db.flush()
        created.append(record)
        for detection in contributing:
            db.add(
                RecommendationDetectionLink(
                    organization_id=organization_id,
                    record_id=record.id,
                    detection_id=detection.id,
                    chain_key=detection.chain_key,
                    severity_at_generation=detection.severity,
                    detection_class=detection.detection_class,
                    confidence=detection.confidence,
                    location=_location_dict(detection),
                )
            )

    # MAT-5: each unmatched detection gets its own Needs Recommendation
    # record, never dropped, defaulted, or approximated into something else
    for detection in unmatched:
        record = RecommendationRecord(
            id=str(uuid4()),
            organization_id=organization_id,
            status="Needs Recommendation",
            matched_entry_id=None,
            matched_entry_version=None,
            rollup_scope=rollup_scope,
            scope_key=_scope_key(detection, rollup_scope),
            run_id=run_id,
        )
        db.add(record)
        db.flush()
        created.append(record)
        db.add(
            RecommendationDetectionLink(
                organization_id=organization_id,
                record_id=record.id,
                detection_id=detection.id,
                chain_key=detection.chain_key,
                severity_at_generation=detection.severity,
                detection_class=detection.detection_class,
                confidence=detection.confidence,
                location=_location_dict(detection),
            )
        )

    return created


def _undispositioned_identity(
    matched_entry_id, matched_entry_version, scope_key: str, chain_keys: frozenset
) -> tuple:
    # what actually makes an undispositioned record "the same one" across a
    # rerun: same matched entry *and version* (or unmatched) in the same
    # scope, made up of the exact same set of contributing chains. version
    # is part of this deliberately -- a Draft record isn't pinned the way
    # an approved one is (MAT-9 only protects dispositioned records), so a
    # library edit that moves the latest version out from under it has to
    # be treated as a real change, not a match.
    #
    # severity isn't part of this key on purpose -- a detection's severity
    # is already baked into which entry it can match (LIB-2's rule key
    # requires an exact severity match), so a severity change that
    # actually matters always shows up as a different matched entry or a
    # different chain set, never as a silent mismatch here.
    if matched_entry_id is not None:
        return ("matched", matched_entry_id, matched_entry_version, scope_key, chain_keys)
    return ("unmatched", scope_key, chain_keys)


def run_resolution(
    db: Session,
    organization_id: str,
    inspection_id: Optional[str],
    detections: list[MatchableDetection],
    rollup_scope: str,
    actor: str,
) -> RecommendationRun:
    entries = _load_active_entries(db, organization_id)
    eligible, dismissed, skipped = _classify(detections)

    groups, unmatched = _resolve_and_group(entries, eligible, rollup_scope)
    total_matched = sum(len(v) for v in groups.values())

    run = RecommendationRun(
        id=str(uuid4()),
        organization_id=organization_id,
        inspection_id=inspection_id,
        rollup_scope=rollup_scope,
        total_detections=len(detections),
        total_matched=total_matched,
        total_unmatched=len(unmatched),
        total_dismissed=len(dismissed),
        total_skipped=len(skipped),
        skipped_manifest=_skipped_manifest(skipped) or None,
    )
    db.add(run)
    db.flush()

    _persist_groups(db, organization_id, run.id, groups, unmatched, rollup_scope)

    record_audit_event(
        db,
        organization_id=organization_id,
        actor=actor,
        action="resolution_run",
        entity_type="resolution_run",
        entity_id=run.id,
        detail={
            "rollup_scope": rollup_scope,
            "total_detections": run.total_detections,
            "total_matched": run.total_matched,
            "total_unmatched": run.total_unmatched,
            "total_dismissed": run.total_dismissed,
            "total_skipped": run.total_skipped,
        },
    )
    db.commit()
    db.refresh(run)
    return run


def _chain_changed(link: RecommendationDetectionLink, effective_by_chain: dict) -> bool:
    """Whether a dispositioned link's contributing chain moved since it was
    generated -- widened per baseline §8.3 beyond a same-chain severity
    comparison to also catch a chain that vanished from the refresh
    entirely, or one that is now data-quality-invalid, or one whose
    review verdict flipped to dismissed after approval. Any of these is a
    real change a reviewer needs to see, not something to leave silently
    pointing at data that no longer backs it.
    """
    eff = effective_by_chain.get(link.chain_key)
    if eff is None:
        return True  # vanished from the refresh entirely
    if eff.skip_reason is not None:
        return True  # now unresolvable (e.g. severity became invalid)
    if eff.dismissed:
        return True  # newly dismissed/rejected after approval
    return eff.severity != link.severity_at_generation


def rerun_resolution(
    db: Session,
    organization_id: str,
    inspection_id: Optional[str],
    detections: list[MatchableDetection],
    rollup_scope: str,
    actor: str,
) -> RecommendationRun:
    """MAT-11. Dispositioned records are protected unless a contributing
    chain changed (see _chain_changed), in which case they supersede.

    Everything else (Draft, Needs Recommendation) recomputes fresh -- but
    "recomputes" no longer means "gets deleted and recreated with a new id
    every single time," even when a rerun produces the exact same group it
    did last time. A record only actually gets replaced when its
    composition genuinely changed (see _undispositioned_identity); a
    record that computes identically is left completely untouched, same
    id, same links, so a reviewer's reference to it doesn't silently break
    on every refresh. What did happen -- which record ids were kept,
    removed, and newly created -- gets written into the rerun's own audit
    event instead of just an aggregate total, so the recompute itself is
    visible in the ledger, not just its outcome.
    """
    effective_by_chain = {d.chain_key: d for d in detections}
    now = datetime.now(timezone.utc)

    excluded_from_fresh_run: set[str] = set()  # chain_keys, not row ids
    superseded_count = 0
    supersede_pairs: list[tuple[str, Optional[str]]] = []  # (old_record_id, successor_id)

    # snapshot the undispositioned records and what makes each one "itself"
    # *before* touching anything, so a rerun that computes the same groups
    # again can just leave them alone. nothing gets deleted yet -- that
    # only happens below, once we know which of these are actually stale.
    undispositioned = db.execute(
        select(RecommendationRecord).where(
            RecommendationRecord.organization_id == organization_id,
            RecommendationRecord.status.in_(["Draft", "Needs Recommendation"]),
        )
    ).scalars().all()

    existing_by_identity: dict[tuple, RecommendationRecord] = {}
    undispositioned_by_id: dict[str, RecommendationRecord] = {r.id: r for r in undispositioned}
    stale_record_ids: set[str] = set()
    for record in undispositioned:
        links = db.execute(
            select(RecommendationDetectionLink).where(RecommendationDetectionLink.record_id == record.id)
        ).scalars().all()
        chain_keys = frozenset(link.chain_key for link in links)
        identity = _undispositioned_identity(
            record.matched_entry_id, record.matched_entry_version, record.scope_key, chain_keys
        )
        existing_by_identity[identity] = record
        stale_record_ids.add(record.id)

    dispositioned = db.execute(
        select(RecommendationRecord).where(
            RecommendationRecord.organization_id == organization_id,
            RecommendationRecord.status.in_(["Approved", "Rejected"]),
        )
    ).scalars().all()

    _, dismissed, skipped = _classify(detections)

    # a placeholder run row so successor records have somewhere to point;
    # totals get filled in once everything below is known
    run = RecommendationRun(
        id=str(uuid4()),
        organization_id=organization_id,
        inspection_id=inspection_id,
        rollup_scope=rollup_scope,
        total_detections=len(detections),
        total_matched=0,
        total_unmatched=0,
        total_dismissed=len(dismissed),
        total_skipped=len(skipped),
        skipped_manifest=_skipped_manifest(skipped) or None,
    )
    db.add(run)
    db.flush()

    for record in dispositioned:
        links = db.execute(
            select(RecommendationDetectionLink).where(RecommendationDetectionLink.record_id == record.id)
        ).scalars().all()

        changed = [link for link in links if _chain_changed(link, effective_by_chain)]
        unchanged = [link for link in links if link not in changed]

        if not changed:
            # nothing about this record's contributors moved, so it's
            # still accurate; leave it alone entirely
            excluded_from_fresh_run.update(link.chain_key for link in links)
            continue

        record.status = "Superseded"
        record.updated_at = now
        superseded_count += 1

        if unchanged:
            successor = RecommendationRecord(
                id=str(uuid4()),
                organization_id=organization_id,
                status="Draft",
                matched_entry_id=record.matched_entry_id,
                matched_entry_version=record.matched_entry_version,
                rollup_scope=record.rollup_scope,
                scope_key=record.scope_key,
                run_id=run.id,
                supersedes_record_id=record.id,
            )
            db.add(successor)
            db.flush()
            for link in unchanged:
                db.add(
                    RecommendationDetectionLink(
                        organization_id=organization_id,
                        record_id=successor.id,
                        detection_id=link.detection_id,
                        chain_key=link.chain_key,
                        severity_at_generation=link.severity_at_generation,
                        detection_class=link.detection_class,
                        confidence=link.confidence,
                        location=link.location,
                    )
                )
                excluded_from_fresh_run.add(link.chain_key)
            supersede_pairs.append((record.id, successor.id))
        else:
            supersede_pairs.append((record.id, None))
        # chains in `changed` are deliberately left out of
        # excluded_from_fresh_run: they fall through to fresh resolution
        # below, independently, per MAT-11 (a vanished or skip-flagged
        # chain simply never reappears there, which is correct)

    entries = _load_active_entries(db, organization_id)
    eligible, _, _ = _classify(detections)
    fresh_pool = [d for d in eligible if d.chain_key not in excluded_from_fresh_run]
    groups, unmatched = _resolve_and_group(entries, fresh_pool, rollup_scope)
    fresh_matched = sum(len(v) for v in groups.values())

    # anything that computes to an identity we already have gets left
    # alone entirely -- pulled out of the stale set, and out of what
    # actually gets persisted below, since persisting it again would just
    # be replacing a record with an identical copy of itself under a new id
    kept_record_ids: list[str] = []
    new_groups: dict[tuple, list[MatchableDetection]] = {}
    for group_key, contributing in groups.items():
        entry_id, entry_version, scope_key = group_key
        identity = _undispositioned_identity(
            entry_id, entry_version, scope_key, frozenset(d.chain_key for d in contributing)
        )
        existing = existing_by_identity.get(identity)
        if existing is not None:
            stale_record_ids.discard(existing.id)
            existing.run_id = run.id
            kept_record_ids.append(existing.id)
        else:
            new_groups[group_key] = contributing

    new_unmatched: list[MatchableDetection] = []
    for detection in unmatched:
        scope_key = _scope_key(detection, rollup_scope)
        identity = _undispositioned_identity(None, None, scope_key, frozenset([detection.chain_key]))
        existing = existing_by_identity.get(identity)
        if existing is not None:
            stale_record_ids.discard(existing.id)
            existing.run_id = run.id
            kept_record_ids.append(existing.id)
        else:
            new_unmatched.append(detection)

    # whatever's left in stale_record_ids didn't match anything this run
    # computed, so it's genuinely stale now, not just old
    for record_id in stale_record_ids:
        # synchronize_session="fetch": the undispositioned snapshot pass
        # above loaded these exact link rows through the ORM (registering
        # them in the session's identity map), so a plain Core-level
        # delete would remove them from the database while leaving stale
        # entries behind in-memory. On a dialect whose autoincrement can
        # reuse a row id after a delete (SQLite's bare rowid, unlike
        # Postgres's serial, which never reuses a value), a link
        # persisted below could then collide with one of those stale
        # entries. "fetch" tells SQLAlchemy to find the matching objects
        # and evict them from the identity map as part of the delete,
        # not just issue the SQL.
        db.execute(
            delete(RecommendationDetectionLink)
            .where(RecommendationDetectionLink.record_id == record_id)
            .execution_options(synchronize_session="fetch")
        )
        db.delete(undispositioned_by_id[record_id])

    created_records = _persist_groups(db, organization_id, run.id, new_groups, new_unmatched, rollup_scope)
    created_record_ids = [r.id for r in created_records]

    run.total_matched = len(excluded_from_fresh_run) + fresh_matched
    run.total_unmatched = len(unmatched)
    db.flush()

    record_audit_event(
        db,
        organization_id=organization_id,
        actor=actor,
        action="resolution_rerun",
        entity_type="resolution_run",
        entity_id=run.id,
        detail={
            "rollup_scope": rollup_scope,
            "total_detections": run.total_detections,
            "total_matched": run.total_matched,
            "total_unmatched": run.total_unmatched,
            "total_dismissed": run.total_dismissed,
            "total_skipped": run.total_skipped,
            "superseded_count": superseded_count,
            "undispositioned_kept": [str(i) for i in kept_record_ids],
            "undispositioned_removed": [str(i) for i in stale_record_ids],
            "undispositioned_created": [str(i) for i in created_record_ids],
        },
    )
    for old_id, successor_id in supersede_pairs:
        record_audit_event(
            db,
            organization_id=organization_id,
            actor=actor,
            action="record_superseded",
            entity_type="recommendation_record",
            entity_id=old_id,
            detail={"successor_record_id": str(successor_id) if successor_id else None},
        )
    db.commit()
    db.refresh(run)
    return run


def get_records_for_run(db: Session, run_id: str) -> list[RecommendationRecord]:
    stmt = select(RecommendationRecord).where(RecommendationRecord.run_id == run_id)
    return list(db.execute(stmt).scalars().all())


def get_detection_ids(db: Session, record_id: str) -> list[str]:
    stmt = select(RecommendationDetectionLink.detection_id).where(
        RecommendationDetectionLink.record_id == record_id
    )
    return [row[0] for row in db.execute(stmt).all()]


def get_detection_confidences(db: Session, record_id: str) -> dict[str, float]:
    # MAT-10: confidence rides along for a reviewer to see, same as
    # detection_ids -- it's never part of the matching decision itself
    stmt = select(RecommendationDetectionLink.detection_id, RecommendationDetectionLink.confidence).where(
        RecommendationDetectionLink.record_id == record_id
    )
    return {row[0]: row[1] for row in db.execute(stmt).all()}


def get_detection_classes(db: Session, record_id: str) -> dict[str, str]:
    stmt = select(RecommendationDetectionLink.detection_id, RecommendationDetectionLink.detection_class).where(
        RecommendationDetectionLink.record_id == record_id
    )
    return {row[0]: row[1] for row in db.execute(stmt).all()}


def get_detection_severities(db: Session, record_id: str) -> dict[str, int]:
    stmt = select(RecommendationDetectionLink.detection_id, RecommendationDetectionLink.severity_at_generation).where(
        RecommendationDetectionLink.record_id == record_id
    )
    return {row[0]: row[1] for row in db.execute(stmt).all()}


# to_record_out (an API response shape) is deferred to the stage that
# builds routers -- there is no RecordOut schema yet, and engine.py
# doesn't need to know about one until something actually asks for it,
# same reasoning Tahya's original applied.

# reset_demo_data is NOT ported: the TRUNCATE it used to bypass DAT-5's
# own link-immutability trigger has no legitimate place behind an
# authenticated production endpoint, and nothing in the platform's
# review lifecycle needs an equivalent.
