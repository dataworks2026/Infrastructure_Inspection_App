"""
Seed script: Governor's Island + Brooklyn Army Terminal infrastructure assets
and ready-to-fly GCS demo missions.
Run from backend/ directory:
  python scripts/seed_governors_island.py
"""
import math
import sys
import os
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.asset import Asset
from app.models.user import User
from app.models.inspection import Inspection
from app.models.mission import Mission
from app.models.mission_waypoint import MissionWaypoint
from app.models.telemetry_point import TelemetryPoint
from app.models.image import Image
from app.models.detection import Detection

# ── Governor's Island assets ────────────────────────────────────────────────

GI_ASSETS = [
    {
        "name": "Soissons Dock",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island — North Ferry Terminal Dock",
        "latitude": 40.6932,
        "longitude": -74.0153,
        "status": "active",
    },
    {
        "name": "Castle Williams",
        "infrastructure_type": "coastal",
        "location_name": "Governor's Island — Northwest Shore",
        "latitude": 40.6922,
        "longitude": -74.0163,
        "status": "active",
    },
    {
        "name": "South Battery Seawall",
        "infrastructure_type": "coastal",
        "location_name": "Governor's Island — South Battery",
        "latitude": 40.6869,
        "longitude": -74.0152,
        "status": "active",
    },
    {
        "name": "Yankee Pier",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island — Southwest Dock",
        "latitude": 40.6868,
        "longitude": -74.0170,
        "status": "active",
    },
    {
        "name": "North Shore Seawall",
        "infrastructure_type": "coastal",
        "location_name": "Governor's Island — North Shoreline",
        "latitude": 40.6935,
        "longitude": -74.0168,
        "status": "active",
    },
    {
        "name": "East Breakwater",
        "infrastructure_type": "breakwater",
        "location_name": "Governor's Island — East Harbour",
        "latitude": 40.6908,
        "longitude": -74.0115,
        "status": "active",
    },
]

# ── Brooklyn Army Terminal assets ───────────────────────────────────────────

BAT_ASSETS = [
    {
        "name": "BAT Pier 4",
        "infrastructure_type": "pier",
        "location_name": "Brooklyn Army Terminal — South Pier Complex",
        "latitude": 40.6468,
        "longitude": -74.0224,
        "status": "active",
    },
    {
        "name": "BAT Pier 6",
        "infrastructure_type": "pier",
        "location_name": "Brooklyn Army Terminal — North Pier",
        "latitude": 40.6473,
        "longitude": -74.0231,
        "status": "maintenance",
    },
    {
        "name": "Warehouse A Facade",
        "infrastructure_type": "building",
        "location_name": "Brooklyn Army Terminal — Waterfront Warehouse",
        "latitude": 40.6481,
        "longitude": -74.0232,
        "status": "active",
    },
    {
        "name": "BAT Bulkhead",
        "infrastructure_type": "coastal",
        "location_name": "Brooklyn Army Terminal — Waterfront Bulkhead",
        "latitude": 40.6465,
        "longitude": -74.0218,
        "status": "active",
    },
    {
        "name": "Shed B",
        "infrastructure_type": "building",
        "location_name": "Brooklyn Army Terminal — Central Storage Shed",
        "latitude": 40.6476,
        "longitude": -74.0226,
        "status": "active",
    },
]

# ── Detection library for completed demo missions ───────────────────────────

GI_DETECTIONS = [
    ("Sheet Pile Section Loss", "S3", 0.93),
    ("Through-Wall Corrosion", "S4", 0.96),
    ("Cap Beam Spalling", "S2", 0.87),
    ("Armor Stone Displacement", "S3", 0.89),
    ("Filter Layer Exposure", "S4", 0.94),
    ("Timber Pile Decay", "S3", 0.92),
    ("Deck Slab Delamination", "S2", 0.86),
]

BAT_DETECTIONS = [
    ("Concrete Spalling — Pier Cap", "S3", 0.91),
    ("Exposed Rebar — Column Face", "S4", 0.97),
    ("Efflorescence — Facade Panel", "S2", 0.84),
    ("Crack Pattern — Bulkhead Face", "S3", 0.88),
    ("Pile Cap Erosion", "S4", 0.95),
]


# ── Waypoint geometry helpers ────────────────────────────────────────────────

_LAT_M = 1 / 111_000  # degrees lat per meter


def _lon_m(lat: float) -> float:
    return 1 / (111_000 * math.cos(math.radians(lat)))


def _orbit_waypoints(
    center_lat: float,
    center_lon: float,
    radius_m: float = 50.0,
    n: int = 8,
    alt_m: float = 35.0,
    speed_ms: float = 7.0,
    gimbal_pitch: float = -45.0,
) -> list[dict]:
    wps = []
    for i in range(n):
        angle = (2 * math.pi * i) / n
        lat = center_lat + radius_m * math.sin(angle) * _LAT_M
        lon = center_lon + radius_m * math.cos(angle) * _lon_m(center_lat)
        heading = (math.degrees(math.atan2(-math.cos(angle), -math.sin(angle))) + 360) % 360
        wps.append({
            "sequence_index": i,
            "latitude": lat,
            "longitude": lon,
            "altitude_m": alt_m,
            "speed_ms": speed_ms,
            "gimbal_pitch": gimbal_pitch,
            "heading_deg": heading,
            "action": "photo_all",
        })
    return wps


def _facade_waypoints(
    anchor_lat: float,
    anchor_lon: float,
    length_m: float = 60.0,
    bearing_deg: float = 90.0,
    standoff_m: float = 15.0,
    n: int = 7,
    alt_m: float = 30.0,
    speed_ms: float = 5.0,
    gimbal_pitch: float = -30.0,
) -> list[dict]:
    """Straight-line pass in front of a facade at standoff_m."""
    bearing = math.radians(bearing_deg)
    perp = math.radians(bearing_deg - 90)
    wps = []
    for i in range(n):
        t = i / (n - 1) - 0.5  # -0.5 to +0.5 along facade
        d = t * length_m
        lat = anchor_lat + d * math.cos(bearing) * _LAT_M + standoff_m * math.cos(perp) * _LAT_M
        lon = anchor_lon + d * math.sin(bearing) * _lon_m(anchor_lat) + standoff_m * math.sin(perp) * _lon_m(anchor_lat)
        wps.append({
            "sequence_index": i,
            "latitude": lat,
            "longitude": lon,
            "altitude_m": alt_m,
            "speed_ms": speed_ms,
            "gimbal_pitch": gimbal_pitch,
            "heading_deg": (bearing_deg + 90) % 360,
            "action": "photo_all",
        })
    return wps


def _grid_waypoints(
    sw_lat: float,
    sw_lon: float,
    width_m: float = 80.0,
    height_m: float = 60.0,
    rows: int = 4,
    alt_m: float = 40.0,
    speed_ms: float = 8.0,
    gimbal_pitch: float = -90.0,
) -> list[dict]:
    """Boustrophedon grid (lawnmower pattern) over a rectangular area."""
    wps = []
    idx = 0
    cols = max(2, int(width_m / 20))
    for r in range(rows):
        lat = sw_lat + (r / (rows - 1)) * height_m * _LAT_M
        col_range = range(cols) if r % 2 == 0 else range(cols - 1, -1, -1)
        for c in col_range:
            lon = sw_lon + (c / (cols - 1)) * width_m * _lon_m(sw_lat)
            wps.append({
                "sequence_index": idx,
                "latitude": lat,
                "longitude": lon,
                "altitude_m": alt_m,
                "speed_ms": speed_ms,
                "gimbal_pitch": gimbal_pitch,
                "action": "photo_all",
            })
            idx += 1
    return wps


# ── DB helpers ───────────────────────────────────────────────────────────────

def _upsert_asset(db, data: dict, user_id: str, org_id: str) -> Asset:
    existing = db.query(Asset).filter(
        Asset.organization_id == org_id,
        Asset.name == data["name"],
    ).first()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        print(f"  Updated asset : {data['name']}")
        return existing
    a = Asset(**data, created_by=user_id, organization_id=org_id)
    db.add(a)
    db.flush()
    print(f"  Created asset : {data['name']}")
    return a


def _seed_planned_mission(
    db,
    *,
    org_id: str,
    user_id: str,
    asset: Asset,
    name: str,
    routine_type: str,
    waypoints: list[dict],
    drone_model: str = "DJI Matrice 350 RTK",
    drone_serial: str | None = None,
    sensor_payload: str = "Zenmuse H20T",
) -> Mission | None:
    existing = db.query(Mission).filter(
        Mission.organization_id == org_id,
        Mission.name == name,
    ).first()
    if existing:
        print(f"  Mission exists  : {name}")
        return None

    m = Mission(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        asset_id=asset.id,
        created_by=user_id,
        name=name,
        routine_type=routine_type,
        status="planned",
        drone_model=drone_model,
        drone_serial=drone_serial or f"M350-{uuid.uuid4().hex[:6].upper()}",
        sensor_payload=sensor_payload,
        total_photos=len(waypoints),
        photos_uploaded=0,
        photos_analyzed=0,
    )
    db.add(m)
    db.flush()

    for wp_data in waypoints:
        wp = MissionWaypoint(
            id=str(uuid.uuid4()),
            mission_id=m.id,
            **wp_data,
        )
        db.add(wp)

    db.commit()
    print(f"  Created mission : {name} ({len(waypoints)} waypoints, status=planned)")
    return m


def _seed_completed_mission(
    db,
    *,
    org_id: str,
    user_id: str,
    asset: Asset,
    name: str,
    routine_type: str,
    detections: list[tuple],
    days_ago: int = 3,
) -> Mission | None:
    insp_name = f"{name} — completed"
    existing_insp = db.query(Inspection).filter(
        Inspection.asset_id == asset.id,
        Inspection.name == insp_name,
    ).first()
    if existing_insp:
        print(f"  Inspection exists: {name}")
        return None

    now = datetime.utcnow()
    insp = Inspection(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        asset_id=asset.id,
        created_by=user_id,
        name=insp_name,
        status="completed",
        inspection_date=now - timedelta(days=days_ago),
    )
    db.add(insp)
    db.flush()

    m = Mission(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        inspection_id=insp.id,
        asset_id=asset.id,
        created_by=user_id,
        name=name,
        routine_type=routine_type,
        status="completed",
        drone_model="DJI Matrice 350 RTK",
        drone_serial=f"M350-{uuid.uuid4().hex[:6].upper()}",
        sensor_payload="Zenmuse H20T",
        total_photos=len(detections),
        photos_uploaded=len(detections),
        photos_analyzed=len(detections),
        odm_status="completed",
        actual_start=now - timedelta(days=days_ago, hours=2),
        actual_end=now - timedelta(days=days_ago, hours=1),
        flight_duration_s=3600,
    )
    db.add(m)
    db.flush()

    for i, (label, severity, confidence) in enumerate(detections):
        img = Image(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            inspection_id=insp.id,
            mission_id=m.id,
            filename=f"det_{m.id[:6]}_{i+1:03d}.jpg",
            original_filename=f"det_{m.id[:6]}_{i+1:03d}.jpg",
            s3_bucket="infrastructure-marking-images",
            upload_completed=True,
            gps_lat=asset.latitude + (i * 0.0001),
            gps_lon=asset.longitude + (i * 0.0001),
            analysis_status="completed",
        )
        db.add(img)
        db.flush()

        det = Detection(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            image_id=img.id,
            damage_type=label,
            severity=severity,
            confidence=confidence,
            confidence_score=confidence,
            model_name="yolov8-maritime",
            model_version="1.0",
        )
        db.add(det)

    db.commit()
    print(f"  Created completed mission '{name}' with {len(detections)} detections")
    return m


def seed():
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.organization_id != None).first()  # noqa: E711
        if not user:
            print("No user with org found — register first at POST /api/v1/auth/register")
            return

        org_id = user.organization_id

        # ── Governor's Island: upsert assets ──────────────────────────────
        print("\n[Governor's Island — Assets]")
        gi_map = {}
        for data in GI_ASSETS:
            gi_map[data["name"]] = _upsert_asset(db, data, user.id, org_id)
        db.commit()

        # ── GI: completed demo mission for 3D twin (Soissons Dock) ────────
        print("\n[Governor's Island — Completed mission for 3D twin]")
        _seed_completed_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=gi_map["Soissons Dock"],
            name="Soissons Dock — Orbit Survey",
            routine_type="orbit",
            detections=GI_DETECTIONS,
            days_ago=3,
        )

        # ── GI: ready-to-fly planned missions ────────────────────────────
        print("\n[Governor's Island — Ready-to-fly missions]")

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=gi_map["Castle Williams"],
            name="Castle Williams — Perimeter Orbit",
            routine_type="orbit",
            waypoints=_orbit_waypoints(
                40.6922, -74.0163,
                radius_m=55.0, n=12, alt_m=38.0, speed_ms=6.0, gimbal_pitch=-45.0,
            ),
        )

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=gi_map["South Battery Seawall"],
            name="South Battery Seawall — Facade Scan",
            routine_type="sweep",
            waypoints=_facade_waypoints(
                40.6869, -74.0152,
                length_m=120.0, bearing_deg=90.0,
                standoff_m=12.0, n=8, alt_m=28.0, speed_ms=4.5, gimbal_pitch=-35.0,
            ),
        )

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=gi_map["Soissons Dock"],
            name="Soissons Dock — Structural Grid",
            routine_type="grid",
            waypoints=_grid_waypoints(
                40.6929, -74.0157,
                width_m=70.0, height_m=40.0, rows=4, alt_m=32.0, speed_ms=6.0,
            ),
        )

        # ── GI: in-progress live demo (Yankee Pier) ─────────────────────
        print("\n[Governor's Island — Live demo mission]")
        existing_live = db.query(Mission).filter(
            Mission.organization_id == org_id,
            Mission.name == "Yankee Pier — Live Demo",
        ).first()
        if not existing_live:
            live_asset = gi_map["Yankee Pier"]
            live_m = Mission(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                asset_id=live_asset.id,
                created_by=user.id,
                name="Yankee Pier — Live Demo",
                routine_type="sweep",
                status="in_progress",
                drone_model="DJI Matrice 350 RTK",
                drone_serial="M350-LIVE-001",
                sensor_payload="Zenmuse H20T",
                total_photos=0,
                photos_uploaded=0,
                photos_analyzed=0,
                actual_start=datetime.utcnow() - timedelta(minutes=12),
            )
            db.add(live_m)
            db.flush()

            lat, lon = live_asset.latitude, live_asset.longitude
            now = datetime.utcnow()
            for i in range(5):
                tp = TelemetryPoint(
                    mission_id=live_m.id,
                    timestamp=now - timedelta(seconds=(4 - i) * 30),
                    latitude=lat + i * 0.00005,
                    longitude=lon + i * 0.00005,
                    altitude_agl=30.0 + i,
                    heading_deg=float(i * 45 % 360),
                    speed_ms=8.5,
                    battery_pct=87.0 - i * 2,
                    battery_voltage=25.2,
                    gps_satellites=16,
                    gps_fix_type="rtk_fixed",
                    flight_mode="AUTO",
                )
                db.add(tp)
            db.commit()
            print(f"  Created live demo mission 'Yankee Pier — Live Demo' with 5 telemetry points")
        else:
            print(f"  Live demo mission already exists")

        # ── Brooklyn Army Terminal: upsert assets ─────────────────────────
        print("\n[Brooklyn Army Terminal — Assets]")
        bat_map = {}
        for data in BAT_ASSETS:
            bat_map[data["name"]] = _upsert_asset(db, data, user.id, org_id)
        db.commit()

        # ── BAT: completed demo mission (Pier 4, for 3D twin) ────────────
        print("\n[Brooklyn Army Terminal — Completed mission for 3D twin]")
        _seed_completed_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=bat_map["BAT Pier 4"],
            name="BAT Pier 4 — Orbit Survey",
            routine_type="orbit",
            detections=BAT_DETECTIONS,
            days_ago=5,
        )

        # ── BAT: ready-to-fly planned missions ───────────────────────────
        print("\n[Brooklyn Army Terminal — Ready-to-fly missions]")

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=bat_map["BAT Pier 4"],
            name="BAT Pier 4 — Structural Orbit",
            routine_type="orbit",
            waypoints=_orbit_waypoints(
                40.6468, -74.0224,
                radius_m=45.0, n=10, alt_m=35.0, speed_ms=7.0, gimbal_pitch=-45.0,
            ),
        )

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=bat_map["Warehouse A Facade"],
            name="Warehouse A — Facade Inspection",
            routine_type="sweep",
            waypoints=_facade_waypoints(
                40.6481, -74.0232,
                length_m=150.0, bearing_deg=0.0,
                standoff_m=20.0, n=9, alt_m=35.0, speed_ms=4.0, gimbal_pitch=-30.0,
            ),
        )

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=bat_map["BAT Bulkhead"],
            name="BAT Bulkhead — Perimeter Scan",
            routine_type="sweep",
            waypoints=_facade_waypoints(
                40.6465, -74.0218,
                length_m=90.0, bearing_deg=80.0,
                standoff_m=10.0, n=7, alt_m=25.0, speed_ms=4.5, gimbal_pitch=-40.0,
            ),
        )

        _seed_planned_mission(
            db,
            org_id=org_id,
            user_id=user.id,
            asset=bat_map["BAT Pier 6"],
            name="BAT Pier 6 — Grid Survey",
            routine_type="grid",
            waypoints=_grid_waypoints(
                40.6470, -74.0234,
                width_m=60.0, height_m=50.0, rows=4, alt_m=40.0, speed_ms=7.0,
            ),
        )

        print("\n=== Seed complete ===")
        print("Governor's Island: 6 assets, 1 completed mission, 3 planned, 1 live demo")
        print("Brooklyn Army Terminal: 5 assets, 1 completed mission, 4 planned")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
