from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.models.inspection import Inspection
from app.models.image import Image
from app.models.detection import Detection
from app.models.mission import Mission
from app.models.telemetry_point import TelemetryPoint

router = APIRouter()


def _norm_sev(sev: str) -> str:
    """Normalize S0/0 → S1, plain digits → S-prefixed."""
    if sev in ("S0", "0"):
        return "S1"
    _map = {"1": "S1", "2": "S2", "3": "S3", "4": "S4"}
    return _map.get(sev, sev)


@router.get("/defect-summary")
def get_defect_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return defect counts grouped by asset, damage_type, and severity."""
    org_id = current_user.organization_id

    rows = (
        db.query(
            Asset.id.label("asset_id"),
            Asset.name.label("asset_name"),
            Detection.damage_type,
            Detection.severity,
            func.count(Detection.id).label("cnt"),
        )
        .join(Image, Detection.image_id == Image.id)
        .join(Inspection, Image.inspection_id == Inspection.id)
        .join(Asset, Inspection.asset_id == Asset.id)
        .filter(
            Image.organization_id == org_id,
            Detection.damage_type.isnot(None),
            Detection.severity.isnot(None),
        )
        .group_by(Asset.id, Asset.name, Detection.damage_type, Detection.severity)
        .all()
    )

    # Count inspected images per asset
    img_rows = (
        db.query(
            Asset.id.label("asset_id"),
            func.count(Image.id.distinct()).label("img_count"),
        )
        .join(Inspection, Asset.id == Inspection.asset_id)
        .join(Image, Image.inspection_id == Inspection.id)
        .join(Detection, Detection.image_id == Image.id)
        .filter(Asset.organization_id == org_id)
        .group_by(Asset.id)
        .all()
    )
    img_counts = {r.asset_id: r.img_count for r in img_rows}

    # Build per-asset summaries.
    # Group damage types case-insensitively so e.g. "Corrosion" and "corrosion"
    # merge into a single row, displayed with a canonical Title-Case label.
    assets: dict = {}  # asset_id -> {name, summary: {dt_key: {label, S1..S4, total}}}
    for r in rows:
        aid = r.asset_id
        if aid not in assets:
            assets[aid] = {"asset_id": aid, "asset_name": r.asset_name, "summary": {}}
        summary = assets[aid]["summary"]
        raw_dt = (r.damage_type or "").strip()
        dt_key = raw_dt.lower()
        sev = _norm_sev(r.severity)
        if sev not in ("S1", "S2", "S3", "S4"):
            continue
        if dt_key not in summary:
            summary[dt_key] = {
                "label": raw_dt.title(),
                "S1": 0, "S2": 0, "S3": 0, "S4": 0, "total": 0,
            }
        summary[dt_key][sev] += r.cnt
        summary[dt_key]["total"] += r.cnt

    result = []
    for aid, data in assets.items():
        summary = data["summary"]
        sorted_items = sorted(summary.items(), key=lambda x: -x[1]["total"])
        grand_total = sum(v["total"] for v in summary.values())
        result.append({
            "asset_id": data["asset_id"],
            "asset_name": data["asset_name"],
            "damage_types": [
                {
                    "damage_type": counts["label"],
                    "S1": counts["S1"], "S2": counts["S2"],
                    "S3": counts["S3"], "S4": counts["S4"],
                    "total": counts["total"],
                }
                for _dt_key, counts in sorted_items
            ],
            "totals": {
                "S1": sum(v["S1"] for v in summary.values()),
                "S2": sum(v["S2"] for v in summary.values()),
                "S3": sum(v["S3"] for v in summary.values()),
                "S4": sum(v["S4"] for v in summary.values()),
                "total": grand_total,
            },
            "inspected_images": img_counts.get(aid, 0),
            "total_annotations": grand_total,
        })

    # Sort by total annotations desc
    result.sort(key=lambda x: -x["total_annotations"])
    return {"assets": result}


@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):

    org_id = current_user.organization_id

    # ── Query 1: asset totals ──────────────────────────────────────────────────
    asset_row = db.query(
        func.count(Asset.id).label("total"),
        func.count(case((Asset.status == "active", 1))).label("active"),
    ).filter(Asset.organization_id == org_id).first()

    # ── Query 2: inspection totals ─────────────────────────────────────────────
    insp_row = db.query(
        func.count(Inspection.id).label("total"),
        func.count(case((Inspection.status == "pending", 1))).label("pending"),
    ).filter(Inspection.organization_id == org_id).first()

    # ── Query 3: image + detection counts ─────────────────────────────────────
    total_images = db.query(func.count(Image.id)).filter(Image.organization_id == org_id).scalar() or 0
    total_detections = (
        db.query(func.count(Detection.id))
        .join(Image, Detection.image_id == Image.id)
        .filter(Image.organization_id == org_id)
        .scalar() or 0
    )

    # ── Query 4: assets by infrastructure type ────────────────────────────────
    type_rows = (
        db.query(Asset.infrastructure_type, func.count(Asset.id).label("cnt"))
        .filter(Asset.organization_id == org_id)
        .group_by(Asset.infrastructure_type)
        .all()
    )
    assets_by_type = {row.infrastructure_type: row.cnt for row in type_rows}

    # ── Query 5: recent inspections (limit 5) ─────────────────────────────────
    recent_inspections = (
        db.query(Inspection)
        .filter(Inspection.organization_id == org_id)
        .order_by(Inspection.created_at.desc())
        .limit(5)
        .all()
    )
    recent = [
        {
            "id": i.id,
            "name": i.name,
            "asset_id": i.asset_id,
            "status": i.status,
            "created_at": i.created_at.isoformat() if i.created_at else None,
        }
        for i in recent_inspections
    ]

    # ── Query 6: analyzed images per asset (up to 10 each, severity-ranked) ────
    # Fetch all completed images with their detection info, then group per-asset
    all_img_rows = (
        db.query(
            Image.id,
            Image.filename,
            Image.stored_path,
            Inspection.id.label("inspection_id"),
            Inspection.name.label("inspection_name"),
            Asset.id.label("asset_id"),
            Asset.name.label("asset_name"),
            func.count(Detection.id).label("detection_count"),
            func.max(Detection.severity).label("max_severity"),
        )
        .join(Inspection, Image.inspection_id == Inspection.id)
        .join(Asset, Inspection.asset_id == Asset.id)
        .outerjoin(Detection, Detection.image_id == Image.id)
        .filter(
            Image.organization_id == org_id,
            Image.analysis_status == "completed",
            Image.deleted_at.is_(None),
        )
        .group_by(
            Image.id, Image.filename, Image.stored_path,
            Inspection.id, Inspection.name, Asset.id, Asset.name,
        )
        .order_by(func.max(Detection.severity).desc().nullslast(), Image.created_at.desc())
        .all()
    )
    # Group by asset and take top 10 per asset
    _per_asset: dict = {}
    for row in all_img_rows:
        aid = row.asset_id
        if aid not in _per_asset:
            _per_asset[aid] = []
        if len(_per_asset[aid]) < 10:
            _per_asset[aid].append(row)

    # Collect image IDs that will be returned, then fetch detections per image
    _selected_image_ids = [row.id for imgs in _per_asset.values() for row in imgs]
    _damage_map: dict = {}  # image_id -> [{"damage_type": str, "count": int}, ...]
    _detections_map: dict = {}  # image_id -> [{damage_type, confidence, bbox}, ...]
    if _selected_image_ids:
        _dt_rows = (
            db.query(
                Detection.image_id,
                Detection.damage_type,
                func.count(Detection.id).label("cnt"),
            )
            .filter(Detection.image_id.in_(_selected_image_ids))
            .group_by(Detection.image_id, Detection.damage_type)
            .order_by(func.count(Detection.id).desc())
            .all()
        )
        for r in _dt_rows:
            _damage_map.setdefault(r.image_id, []).append(
                {"damage_type": r.damage_type, "count": r.cnt}
            )
        # Fetch individual detections with bounding boxes
        _det_rows = (
            db.query(
                Detection.image_id,
                Detection.damage_type,
                Detection.confidence,
                Detection.severity,
                Detection.bbox_x1,
                Detection.bbox_y1,
                Detection.bbox_x2,
                Detection.bbox_y2,
            )
            .filter(
                Detection.image_id.in_(_selected_image_ids),
                Detection.bbox_x1.isnot(None),
            )
            .all()
        )
        for r in _det_rows:
            _detections_map.setdefault(r.image_id, []).append({
                "damage_type": r.damage_type,
                "confidence": r.confidence,
                "severity": r.severity,
                "bbox": {"x1": r.bbox_x1, "y1": r.bbox_y1, "x2": r.bbox_x2, "y2": r.bbox_y2},
            })

    recent_analyzed_images = [
        {
            "id": row.id,
            "filename": row.filename,
            "url": f"/storage/{row.stored_path}" if row.stored_path else "",
            "inspection_id": row.inspection_id,
            "inspection_name": row.inspection_name,
            "asset_id": row.asset_id,
            "asset_name": row.asset_name,
            "detection_count": row.detection_count,
            "max_severity": row.max_severity,
            "damage_types": _damage_map.get(row.id, []),
            "detections": _detections_map.get(row.id, []),
        }
        for imgs in _per_asset.values()
        for row in imgs
    ]

    # ── Query 7: asset health table (ranked critical-first) ───────────────────
    asset_health_rows = (
        db.query(
            Asset.id,
            Asset.name,
            Asset.infrastructure_type,
            Asset.status,
            func.count(Inspection.id.distinct()).label("inspection_count"),
            func.count(Detection.id).label("total_detections"),
            func.max(Detection.severity).label("worst_severity"),
        )
        .outerjoin(Inspection, Inspection.asset_id == Asset.id)
        .outerjoin(Image, Image.inspection_id == Inspection.id)
        .outerjoin(Detection, Detection.image_id == Image.id)
        .filter(Asset.organization_id == org_id)
        .group_by(Asset.id, Asset.name, Asset.infrastructure_type, Asset.status)
        .all()
    )
    sev_order = {"S4": 0, "S3": 1, "S2": 2, "S1": 3}
    asset_health = sorted(
        [
            {
                "id": row.id,
                "name": row.name,
                "infrastructure_type": row.infrastructure_type,
                "status": row.status,
                "inspection_count": row.inspection_count,
                "total_detections": row.total_detections,
                "worst_severity": row.worst_severity,
            }
            for row in asset_health_rows
        ],
        key=lambda x: (sev_order.get(x["worst_severity"], 4), -x["total_detections"])
    )

    # ── Query 8: severity breakdown (for donut) ───────────────────────────────
    # Normalize legacy S0 → S1 (and bare digits) before tallying so the counts
    # match the Defect Summary and the on-screen badges, which all display S0 as
    # S1. Counting the raw value here under-reported S1 (S0 fell into its own
    # bucket) while S2-S4 looked correct.
    sev_rows = (
        db.query(Detection.severity, func.count(Detection.id).label("cnt"))
        .join(Image, Detection.image_id == Image.id)
        .filter(Image.organization_id == org_id, Detection.severity.isnot(None))
        .group_by(Detection.severity)
        .all()
    )
    severity_breakdown: dict = {}
    for row in sev_rows:
        key = _norm_sev(row.severity)
        if key not in ("S1", "S2", "S3", "S4"):
            continue
        severity_breakdown[key] = severity_breakdown.get(key, 0) + row.cnt

    # ── Query 8b: per-asset severity breakdown (authoritative totals) ─────────
    # The dashboard's per-asset S1-S4 counts must match the Defect Summary and
    # the inspection totals. They were previously derived on the frontend from
    # recent_analyzed_images, which is capped at 10 images per asset — so assets
    # with >10 analyzed images under-counted. Compute the true totals here over
    # ALL detections (severity not null, S0→S1 normalized), no cap, no bbox filter.
    asset_sev_rows = (
        db.query(
            Asset.id.label("asset_id"),
            Detection.severity,
            func.count(Detection.id).label("cnt"),
        )
        .join(Inspection, Inspection.asset_id == Asset.id)
        .join(Image, Image.inspection_id == Inspection.id)
        .join(Detection, Detection.image_id == Image.id)
        .filter(Asset.organization_id == org_id, Detection.severity.isnot(None))
        .group_by(Asset.id, Detection.severity)
        .all()
    )
    asset_severity: dict = {}  # asset_id -> {S1..S4}
    for row in asset_sev_rows:
        key = _norm_sev(row.severity)
        if key not in ("S1", "S2", "S3", "S4"):
            continue
        bucket = asset_severity.setdefault(
            row.asset_id, {"S1": 0, "S2": 0, "S3": 0, "S4": 0}
        )
        bucket[key] += row.cnt

    # ── Fleet health % ─────────────────────────────────────────────────────────
    total_a  = asset_row.total  if asset_row else 0
    active_a = asset_row.active if asset_row else 0
    fleet_health_pct = round((active_a / total_a * 100) if total_a > 0 else 0)

    return {
        "total_assets":           total_a,
        "active_assets":          active_a,
        "total_inspections":      insp_row.total   if insp_row else 0,
        "pending_inspections":    insp_row.pending if insp_row else 0,
        "total_images":           total_images,
        "total_detections":       total_detections,
        "assets_by_type":         assets_by_type,
        "recent_inspections":     recent,
        "recent_analyzed_images": recent_analyzed_images,
        "asset_health":           asset_health,
        "severity_breakdown":     severity_breakdown,
        "asset_severity":         asset_severity,
        "fleet_health_pct":       fleet_health_pct,
    }


# ── P1-18: Live missions for GCS dashboard ───────────────────────────

@router.get("/live-missions")
def get_live_missions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return in-progress/paused missions with latest telemetry for live drone markers."""
    org_id = current_user.organization_id

    missions = db.query(Mission).filter(
        Mission.organization_id == org_id,
        Mission.status.in_(["in_progress", "paused"]),
    ).all()

    results = []
    for m in missions:
        latest = (
            db.query(TelemetryPoint)
            .filter(TelemetryPoint.mission_id == m.id)
            .order_by(TelemetryPoint.timestamp.desc())
            .first()
        )

        entry = {
            "mission_id": m.id,
            "mission_name": m.name,
            "asset_id": m.asset_id,
            "status": m.status,
            "drone_model": m.drone_model,
            "total_photos": m.total_photos,
            "photos_uploaded": m.photos_uploaded,
            "actual_start": m.actual_start.isoformat() if m.actual_start else None,
        }

        if latest:
            entry["telemetry"] = {
                "latitude": latest.latitude,
                "longitude": latest.longitude,
                "altitude_agl": latest.altitude_agl,
                "heading_deg": latest.heading_deg,
                "speed_ms": latest.speed_ms,
                "battery_pct": latest.battery_pct,
                "battery_voltage": latest.battery_voltage,
                "gps_satellites": latest.gps_satellites,
                "flight_mode": latest.flight_mode,
                "timestamp": latest.timestamp.isoformat() if latest.timestamp else None,
            }
        else:
            entry["telemetry"] = None

        results.append(entry)

    return {"live_missions": results, "count": len(results)}
