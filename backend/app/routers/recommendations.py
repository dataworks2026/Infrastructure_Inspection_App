"""Recommendation engine API: the review surface (Stage 3), the engine run
over reviewed findings (Stage 2), the library with spreadsheet import,
the letterhead, and the issued PDF (Stage 4).

Every endpoint is scoped to the caller's organization through the normal
JWT dependency. Writes that change what a customer will be told (run,
approve, reject, library, letterhead) require users.role admin or analyst;
any other role is read only and the refusal is written to the audit trail
with the role, per Rev B 8.3.
"""
import csv
import io
import os
import re
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.models.inspection import Inspection
from app.models.organization import Organization
from app.models.recommendation import (
    RecommendationClassVocabulary,
    RecommendationDetectionLink,
    RecommendationLibraryEntry,
    RecommendationRun,
    RecommendationVocabulary,
)
from app.models.user import User
from app.schemas.recommendation import EntryWrite
from app.schemas.review import ASSET_TYPES as PLATFORM_ASSET_TYPES
from app.services.recommendations import authoring, engine, output, projection, workflow
from app.services.recommendations.audit import list_audit_events, record_audit_event
from app.services.recommendations.detection_feed import (
    ReviewNotCompleted,
    load_matchable_detections,
    signed_classes,
)
from app.services.recommendations.action_classes import ACTION_CLASSES
from app.services.recommendations.errors import FieldValidationError, NotFoundError
from app.services.recommendations.pdf import NoApprovedRecommendations, issue_recommendations_pdf

router = APIRouter()

SEVERITY_LABEL = {1: "S1", 2: "S2", 3: "S3", 4: "S4"}
REVIEWER_ROLES = ("admin", "analyst")
LETTERHEAD_FIELDS = ("firm_name", "address", "phone", "email", "website", "client_name", "prepared_by")
LOGO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg"}
# rule scope by asset type: the platform's image asset types plus the asset-level infrastructure types
KNOWN_ASSET_TYPES = set(PLATFORM_ASSET_TYPES) | {"coastal", "breakwater", "building", "wind_turbine", "jetty", "quay"}


# ----------------------------------------------------------------------------- helpers

def _require_reviewer(db: Session, current_user: User, action: str) -> None:
    role = current_user.role
    if role in REVIEWER_ROLES:
        return
    record_audit_event(
        db, current_user.organization_id, current_user.email, "action_refused", "user", current_user.id,
        detail={"action": action, "role": role, "reason": "role is read only for this action"},
    )
    db.commit()
    raise HTTPException(status_code=403, detail=f"Role '{role}' is read only for {action}")


def _tier_labels(db: Session) -> dict:
    rows = [dict(r._mapping) for r in db.execute(text("select * from recommendation_priority_tiers"))]
    labels = {}
    for r in rows:
        label = next((v for k, v in r.items() if k != "tier" and isinstance(v, str)), str(r.get("tier")))
        labels[int(r["tier"])] = label
    return labels


def _inspection_names(db: Session, org: str) -> dict:
    return {i.id: (i.name or i.id[:8]) for i in db.query(Inspection).filter(Inspection.organization_id == org).all()}


def _org_inspection(db: Session, org: str, inspection_id: str) -> Inspection:
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id, Inspection.organization_id == org).first()
    if inspection is None:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection


def _entry_out(e: RecommendationLibraryEntry) -> dict:
    return {
        "entry_id": e.entry_id, "version": e.version, "is_active": e.is_active, "is_latest": e.is_latest,
        "detection_class": e.detection_class, "severity": e.severity, "asset_type": e.asset_type,
        "asset_id": e.asset_id, "recommendation_text": e.recommendation_text, "action_class": e.action_class,
        "derived_tier": e.derived_tier, "created_by": e.created_by, "created_at": getattr(e, "created_at", None),
        "vocabulary_id": e.vocabulary_id,
    }


def _record_out(db: Session, rec, run, names: dict, tiers: dict) -> dict:
    links = db.query(RecommendationDetectionLink).filter(RecommendationDetectionLink.record_id == rec.id).all()
    entry = None
    if rec.matched_entry_id:
        entry = db.query(RecommendationLibraryEntry).filter(
            RecommendationLibraryEntry.entry_id == rec.matched_entry_id,
            RecommendationLibraryEntry.version == rec.matched_entry_version,
        ).first()
    sev = sorted({link.severity_at_generation for link in links})
    return {
        "id": rec.id, "status": rec.status, "rollup_scope": rec.rollup_scope, "scope_key": rec.scope_key,
        "inspection_id": run.inspection_id if run else None,
        "inspection_name": names.get(run.inspection_id, "") if run else "",
        "detection_class": links[0].detection_class if links else None,
        "severity": [SEVERITY_LABEL.get(s, str(s)) for s in sev],
        "detections": len(links),
        "detection_ids": [link.detection_id for link in links],
        "rule_version": rec.matched_entry_version,
        "rule_id": rec.matched_entry_id,
        "tier": entry.derived_tier if entry else None,
        "tier_label": tiers.get(entry.derived_tier) if entry else None,
        "action_class": entry.action_class if entry else None,
        "recommendation_text": entry.recommendation_text if entry else None,
        "supersedes_record_id": rec.supersedes_record_id,
        "superseded_at": getattr(rec, "superseded_at", None),
        "supersede_reason": getattr(rec, "supersede_reason", None),
        "updated_at": getattr(rec, "updated_at", None),
    }


def _run_out(run: RecommendationRun, names: dict) -> dict:
    return {
        "id": run.id, "inspection_id": run.inspection_id,
        "inspection_name": names.get(run.inspection_id, run.inspection_id),
        "rollup_scope": run.rollup_scope, "producer": getattr(run, "producer", None),
        "total_detections": run.total_detections, "total_matched": run.total_matched,
        "total_unmatched": run.total_unmatched, "total_dismissed": run.total_dismissed,
        "total_skipped": run.total_skipped, "skipped_manifest": run.skipped_manifest or [],
        "created_at": getattr(run, "created_at", None),
    }


# ----------------------------------------------------------------------------- read side

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
    reviewed = [
        {"id": i.id, "name": i.name or i.id[:8], "status": i.status}
        for i in db.query(Inspection).filter(Inspection.organization_id == org).order_by(Inspection.created_at.desc()).all()
    ]
    return {
        "summary": workflow.get_status_summary(db, org),
        "library": {"active_rules": active_rules, "action_classes": list(ACTION_CLASSES)},
        "vocabularies": vocabularies,
        "tiers": _tier_labels(db),
        "runs": [_run_out(r, names) for r in runs],
        "inspections": reviewed,
        "can_review": current_user.role in REVIEWER_ROLES,
        "role": current_user.role,
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
        out.append(_record_out(db, rec, run, names, tiers))
    return out


@router.get("/recommendations/records/{record_id}/delta")
def record_delta(record_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    try:
        return workflow.get_record_delta(db, current_user.organization_id, record_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/recommendations/output")
def approved_output(
    inspection_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return output.build_output(db, current_user.organization_id, inspection_id=inspection_id)


@router.get("/recommendations/audit")
def audit(
    entity_id: Optional[str] = None,
    actor: Optional[str] = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list:
    events = list_audit_events(db, current_user.organization_id, actor=actor, entity_id=entity_id)
    return [
        {"id": e.id, "created_at": e.created_at, "actor": e.actor, "action": e.action,
         "entity_type": e.entity_type, "entity_id": e.entity_id, "entity_version": e.entity_version, "detail": e.detail}
        for e in events[-limit:]
    ]


# ----------------------------------------------------------------------------- Stage 2: run

class RunRequest(BaseModel):
    rollup_scope: str = "asset"
    producer: str = engine.DEFAULT_PRODUCER
    allow_unreviewed: bool = False  # dev and demo only; the audit event records it


@router.post("/recommendations/inspections/{inspection_id}/run")
def run_engine(
    inspection_id: str,
    payload: RunRequest = RunRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    org = current_user.organization_id
    _org_inspection(db, org, inspection_id)
    _require_reviewer(db, current_user, "run")
    if payload.rollup_scope not in engine.ROLLUP_SCOPES:
        raise HTTPException(status_code=422, detail=f"rollup_scope must be one of {engine.ROLLUP_SCOPES}")
    try:
        vocabulary = signed_classes(db, payload.producer)
        detections, feed = load_matchable_detections(
            db, org, inspection_id, vocabulary, require_review=not payload.allow_unreviewed
        )
    except ReviewNotCompleted as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except (NotFoundError, FieldValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not detections:
        raise HTTPException(status_code=422, detail="This inspection has no findings to run the engine on.")

    existing = db.query(RecommendationRun).filter(
        RecommendationRun.organization_id == org, RecommendationRun.inspection_id == inspection_id
    ).count()
    if existing:
        run = engine.rerun_resolution(db, org, inspection_id, detections, payload.rollup_scope, current_user.email, payload.producer)
    else:
        run = engine.run_resolution(db, org, inspection_id, detections, payload.rollup_scope, current_user.email, payload.producer)
    if payload.allow_unreviewed:
        record_audit_event(
            db, org, current_user.email, "resolution_run_unreviewed", "resolution_run", run.id,
            detail={"inspection_id": inspection_id, "inspection_status": feed.inspection_status},
        )
    db.commit()
    names = _inspection_names(db, org)
    counts = {}
    for rec in workflow.list_records(db, org):
        if rec.run_id == run.id:
            counts[rec.status] = counts.get(rec.status, 0) + 1
    return {
        "run": _run_out(run, names), "rerun": bool(existing),
        "feed": {"detections_read": feed.detections_read, "consumed": feed.consumed,
                 "replaced_by_modification": feed.replaced_by_modification, "inspection_status": feed.inspection_status},
        "records": counts,
    }


# ----------------------------------------------------------------------------- Stage 3: disposition

@router.post("/recommendations/records/{record_id}/approve")
def approve(record_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    return _dispose(db, current_user, record_id, "approve")


@router.post("/recommendations/records/{record_id}/reject")
def reject(record_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    return _dispose(db, current_user, record_id, "reject")


def _dispose(db: Session, current_user: User, record_id: str, decision: str) -> dict:
    org = current_user.organization_id
    _require_reviewer(db, current_user, decision)
    try:
        rec = workflow.disposition_record(db, org, record_id, decision, current_user.email)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except FieldValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    projected = projection.project_approved(db, rec, current_user.id) if decision == "approve" else None
    db.commit()
    runs = {r.id: r for r in db.query(RecommendationRun).filter(RecommendationRun.organization_id == org).all()}
    out = _record_out(db, rec, runs.get(rec.run_id), _inspection_names(db, org), _tier_labels(db))
    out["maintenance_recommendation_id"] = projected.recommendation_id if projected else None
    return out


class BulkRequest(BaseModel):
    decision: str
    record_ids: list[str] = Field(default_factory=list)


@router.post("/recommendations/records/bulk")
def bulk(payload: BulkRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    org = current_user.organization_id
    if payload.decision not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="decision must be approve or reject")
    _require_reviewer(db, current_user, f"bulk {payload.decision}")
    try:
        result = workflow.bulk_disposition(db, org, payload.decision, current_user.email, record_ids=payload.record_ids)
    except FieldValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    projected = 0
    if payload.decision == "approve":
        for rid in result.get("succeeded", []):
            rec = workflow._get_record(db, org, str(rid))
            if projection.project_approved(db, rec, current_user.id) is not None:
                projected += 1
    db.commit()
    result["projected"] = projected
    return result


# ----------------------------------------------------------------------------- library

@router.get("/recommendations/library")
def library(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list:
    entries = authoring.list_entries(db, current_user.organization_id, active_only=not include_archived, latest_only=True)
    return [_entry_out(e) for e in entries]


class EntryIn(BaseModel):
    producer: str = engine.DEFAULT_PRODUCER
    detection_class: str
    severity: int
    asset_type: Optional[str] = None
    asset_id: Optional[str] = None
    recommendation_text: str
    action_class: str
    tier_override: Optional[int] = None


def _check_asset_type(asset_type: Optional[str]) -> None:
    if asset_type and asset_type.strip().lower() not in KNOWN_ASSET_TYPES:
        raise ValueError(f"asset_type '{asset_type}' is not an asset type; use one of {', '.join(sorted(KNOWN_ASSET_TYPES))}")


def _entry_write(current_user: User, data: EntryIn) -> EntryWrite:
    try:
        _check_asset_type(data.asset_type)
        return EntryWrite(actor=current_user.email, **data.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/recommendations/library", status_code=201)
def create_rule(data: EntryIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    _require_reviewer(db, current_user, "library create")
    try:
        entry = authoring.create_entry(db, current_user.organization_id, _entry_write(current_user, data))
    except (FieldValidationError, NotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    return _entry_out(entry)


@router.put("/recommendations/library/{entry_id}")
def edit_rule(entry_id: str, data: EntryIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    _require_reviewer(db, current_user, "library edit")
    try:
        entry = authoring.edit_entry(db, current_user.organization_id, entry_id, _entry_write(current_user, data))
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except FieldValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    return _entry_out(entry)


@router.delete("/recommendations/library/{entry_id}")
def archive_rule(entry_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    _require_reviewer(db, current_user, "library archive")
    try:
        result = authoring.archive_entry(db, current_user.organization_id, entry_id, current_user.email)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except FieldValidationError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    return result


@router.get("/recommendations/library/{entry_id}/history")
def rule_history(entry_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list:
    return [_entry_out(e) for e in authoring.get_entry_history(db, current_user.organization_id, entry_id)]


IMPORT_COLUMNS = ("detection_class", "severity", "recommendation_text", "action_class")
IMPORT_OPTIONAL = ("asset_type", "asset_id", "tier_override", "producer")


@router.post("/recommendations/library/import")
async def import_rules(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """LIB-08, bulk spreadsheet import. A CSV with the columns
    detection_class, severity, recommendation_text, action_class and the
    optional asset_type, asset_id, tier_override, producer. Every row goes
    through the same validation as a single create. All or nothing: one bad
    row means nothing is written and every problem is reported by row."""
    _require_reviewer(db, current_user, "library import")
    raw = await file.read()
    try:
        textdata = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="The file must be UTF-8 CSV")
    reader = csv.DictReader(io.StringIO(textdata))
    missing = [c for c in IMPORT_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing columns: {', '.join(missing)}")
    # The authoring service commits per entry, so all-or-nothing is done by
    # validating the whole file first and writing only when every row passes:
    # schema, vocabulary membership, a key already active in the library, and a
    # key repeated inside the file itself.
    org = current_user.organization_id
    rows, problems = [], []
    for n, row in enumerate(reader, start=2):
        try:
            fields = {k: (row.get(k) or "").strip() for k in IMPORT_COLUMNS + IMPORT_OPTIONAL}
            data = EntryIn(
                producer=fields["producer"] or engine.DEFAULT_PRODUCER,
                detection_class=fields["detection_class"], severity=int(fields["severity"]),
                asset_type=fields["asset_type"] or None, asset_id=fields["asset_id"] or None,
                recommendation_text=fields["recommendation_text"], action_class=fields["action_class"],
                tier_override=int(fields["tier_override"]) if fields["tier_override"] else None,
            )
            _check_asset_type(data.asset_type)
            rows.append((n, EntryWrite(actor=current_user.email, **data.model_dump())))
        except ValueError as exc:
            problems.append({"row": n, "error": str(exc)})
    vocab_cache: dict[str, tuple[str, set[str]]] = {}
    active = {
        (e.vocabulary_id, e.detection_class, e.severity, e.asset_type, e.asset_id)
        for e in authoring.list_entries(db, org, active_only=True, latest_only=True)
    }
    seen: dict[tuple, int] = {}
    for n, w in rows:
        try:
            if w.producer not in vocab_cache:
                v = authoring.resolve_vocabulary(db, w.producer)
                vocab_cache[w.producer] = (v.id, signed_classes(db, w.producer))
            vid, classes = vocab_cache[w.producer]
        except (NotFoundError, FieldValidationError) as exc:
            problems.append({"row": n, "error": str(exc)})
            continue
        if w.detection_class not in classes:
            problems.append({"row": n, "error": f"'{w.detection_class}' is not in the signed vocabulary for {w.producer}"})
            continue
        key = (vid, w.detection_class, w.severity, w.asset_type, w.asset_id)
        if key in active:
            problems.append({"row": n, "error": "an active rule with this class, severity and scope already exists"})
        elif key in seen:
            problems.append({"row": n, "error": f"same class, severity and scope as row {seen[key]}"})
        else:
            seen[key] = n
    if problems:
        problems.sort(key=lambda p: p["row"])
        raise HTTPException(status_code=422, detail={"message": "Nothing imported; fix the rows below and try again.", "problems": problems})
    created = []
    for n, w in rows:
        try:
            created.append(authoring.create_entry(db, org, w).entry_id)
        except (FieldValidationError, NotFoundError) as exc:
            raise HTTPException(status_code=422, detail={"message": f"Stopped at row {n} after {len(created)} rows were written: {exc}", "problems": [{"row": n, "error": str(exc)}]})
    db.commit()
    return {"created": len(created), "entry_ids": created}


# ----------------------------------------------------------------------------- letterhead

class LetterheadWrite(BaseModel):
    firm_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    client_name: Optional[str] = None
    prepared_by: Optional[str] = None


def _org(db: Session, current_user: User) -> Organization:
    org = db.query(Organization).filter(Organization.organization_id == current_user.organization_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def _letterhead_out(org: Organization) -> dict:
    lh = dict(((org.settings or {}).get("letterhead") or {}))
    logo = lh.get("logo_path")
    lh["logo_url"] = f"/storage/{logo}" if logo and not os.path.isabs(logo) else None
    lh.setdefault("firm_name", org.name)
    return lh


@router.get("/recommendations/letterhead")
def get_letterhead(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    return _letterhead_out(_org(db, current_user))


@router.put("/recommendations/letterhead")
def put_letterhead(data: LetterheadWrite, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    _require_reviewer(db, current_user, "letterhead")
    org = _org(db, current_user)
    current = dict((org.settings or {}).get("letterhead") or {})
    for k in LETTERHEAD_FIELDS:
        v = getattr(data, k)
        if v is not None:
            current[k] = v.strip()
    org.settings = {**(org.settings or {}), "letterhead": current}
    record_audit_event(db, org.organization_id, current_user.email, "letterhead_updated", "organization", org.organization_id,
                       detail={k: current.get(k) for k in LETTERHEAD_FIELDS})
    db.commit()
    return _letterhead_out(org)


@router.post("/recommendations/letterhead/logo")
async def put_logo(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    _require_reviewer(db, current_user, "letterhead logo")
    if file.content_type not in LOGO_TYPES:
        raise HTTPException(status_code=422, detail="The logo must be a PNG or JPEG")
    org = _org(db, current_user)
    rel = f"letterhead/{org.organization_id}/logo{LOGO_TYPES[file.content_type]}"
    abs_path = os.path.join(settings.STORAGE_BASE_PATH, rel)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as fh:
        fh.write(await file.read())
    current = dict((org.settings or {}).get("letterhead") or {})
    current["logo_path"] = rel
    org.settings = {**(org.settings or {}), "letterhead": current}
    record_audit_event(db, org.organization_id, current_user.email, "letterhead_logo_updated", "organization", org.organization_id,
                       detail={"logo_path": rel})
    db.commit()
    return _letterhead_out(org)


# ----------------------------------------------------------------------------- Stage 4: issued PDF

@router.get("/recommendations/inspections/{inspection_id}/pdf")
def recommendations_pdf(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue the recommendations PDF for one inspection: approved records
    with their pictures, on the organization's letterhead. Every call is an
    issue: the file is archived, a snapshot row is written and the audit
    trail gets an event. There is no preview path on purpose."""
    org = current_user.organization_id
    inspection = _org_inspection(db, org, inspection_id)
    try:
        pdf, snap = issue_recommendations_pdf(db, org, inspection_id, current_user.email)
    except NoApprovedRecommendations:
        raise HTTPException(status_code=422, detail="No approved recommendations for this inspection yet.")
    db.commit()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", (inspection.name or "inspection")).strip("_") or "inspection"
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}-recommendations-{snap.id[:8]}.pdf"',
            "X-Recommendation-Snapshot": snap.id,
        },
    )
