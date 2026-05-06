"""
Seed script: Governor's Island infrastructure assets, inspections, and GCS demo missions.
Run from backend/ directory:
  python scripts/seed_governors_island.py
"""
import sys, os, uuid
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

ASSETS = [
    {
        "name": "Soissons Landing",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island — North Ferry Terminal",
        "latitude": 40.693152,
        "longitude": -74.015206,
        "status": "active",
    },
    {
        "name": "Yankee Pier",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island — Southwest Dock",
        "latitude": 40.686802,
        "longitude": -74.017028,
        "status": "active",
    },
    {
        "name": "Pier 101",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island — East Waterfront",
        "latitude": 40.691400,
        "longitude": -74.012285,
        "status": "maintenance",
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

DEMO_DETECTIONS = [
    ("Sheet Pile Section Loss", "S3", 0.93),
    ("Through-Wall Corrosion", "S4", 0.96),
    ("Cap Beam Spalling", "S2", 0.87),
    ("Armor Stone Displacement", "S3", 0.89),
    ("Filter Layer Exposure", "S4", 0.94),
    ("Timber Pile Decay", "S3", 0.92),
    ("Deck Slab Delamination", "S2", 0.86),
]


def seed():
    db = SessionLocal()
    try:
        user = db.query(User).first()
        if not user:
            print("No user found — register first at POST /api/v1/auth/register")
            return

        org_id = user.organization_id
        created_assets = updated_assets = 0
        asset_map = {}

        # ── Assets ──────────────────────────────────────────────────────
        for data in ASSETS:
            existing = db.query(Asset).filter(
                Asset.organization_id == org_id,
                Asset.name == data["name"],
            ).first()

            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
                updated_assets += 1
                asset_map[data["name"]] = existing
                print(f"  Updated asset : {data['name']}")
            else:
                a = Asset(**data, created_by=user.id, organization_id=org_id)
                db.add(a)
                db.flush()
                asset_map[data["name"]] = a
                created_assets += 1
                print(f"  Created asset : {data['name']}")

        db.commit()

        # ── Completed inspection + mission with detections (for 3D twin demo) ──
        primary_asset = asset_map["Soissons Landing"]
        now = datetime.utcnow()

        existing_insp = db.query(Inspection).filter(
            Inspection.asset_id == primary_asset.id,
            Inspection.name == "Governor's Island demo inspection",
        ).first()

        if not existing_insp:
            insp = Inspection(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                asset_id=primary_asset.id,
                created_by=user.id,
                status="completed",
                inspection_date=now - timedelta(days=3),
                name="Governor's Island demo inspection",
            )
            db.add(insp)
            db.flush()

            mission = Mission(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                inspection_id=insp.id,
                asset_id=primary_asset.id,
                created_by=user.id,
                name="Soissons Landing — Orbit Survey",
                routine_type="orbit",
                status="completed",
                drone_model="DJI Matrice 350 RTK",
                drone_serial="M350-DEMO-001",
                sensor_payload="Zenmuse H20T",
                total_photos=len(DEMO_DETECTIONS),
                photos_uploaded=len(DEMO_DETECTIONS),
                photos_analyzed=len(DEMO_DETECTIONS),
                odm_status="completed",
                actual_start=now - timedelta(days=3, hours=2),
                actual_end=now - timedelta(days=3, hours=1),
                flight_duration_s=3600,
            )
            db.add(mission)
            db.flush()

            for i, (label, severity, confidence) in enumerate(DEMO_DETECTIONS):
                img = Image(
                    id=str(uuid.uuid4()),
                    organization_id=org_id,
                    inspection_id=insp.id,
                    mission_id=mission.id,
                    filename=f"demo_{i+1:03d}.jpg",
                    original_filename=f"demo_{i+1:03d}.jpg",
                    s3_bucket="infrastructure-marking-images",
                    upload_completed=True,
                    gps_lat=primary_asset.latitude + (i * 0.0001),
                    gps_lon=primary_asset.longitude + (i * 0.0001),
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
            print(f"\n  Created completed mission '{mission.name}' with {len(DEMO_DETECTIONS)} detections")
        else:
            print(f"\n  Demo inspection already exists, skipping mission seed")

        # ── In-progress mission (for live missions widget) ───────────────
        existing_live = db.query(Mission).filter(
            Mission.organization_id == org_id,
            Mission.status == "in_progress",
            Mission.name == "Yankee Pier — Live Demo",
        ).first()

        if not existing_live:
            live_asset = asset_map["Yankee Pier"]
            live_mission = Mission(
                id=str(uuid.uuid4()),
                organization_id=org_id,
                asset_id=live_asset.id,
                created_by=user.id,
                name="Yankee Pier — Live Demo",
                routine_type="sweep",
                status="in_progress",
                drone_model="DJI Matrice 350 RTK",
                drone_serial="M350-DEMO-002",
                sensor_payload="Zenmuse H20T",
                total_photos=0,
                photos_uploaded=0,
                photos_analyzed=0,
                actual_start=now - timedelta(minutes=12),
            )
            db.add(live_mission)
            db.flush()

            lat, lon = live_asset.latitude, live_asset.longitude
            for i in range(5):
                tp = TelemetryPoint(
                    mission_id=live_mission.id,
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
            print(f"  Created in-progress mission '{live_mission.name}' with 5 telemetry points")
        else:
            print(f"  Live demo mission already exists, skipping")

        print(f"\nDone. Assets: created={created_assets}, updated={updated_assets}")

    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
