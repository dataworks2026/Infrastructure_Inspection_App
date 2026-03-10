"""
Seed script: Governor's Island infrastructure assets.
Run from backend/ directory:
  python scripts/seed_governors_island.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.asset import Asset
from app.models.user import User

ASSETS = [
    # ── The 3 primary piers ─────────────────────────────────────────────────
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
    # ── Coastal / seawall infrastructure ────────────────────────────────────
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


def seed():
    db = SessionLocal()
    try:
        user = db.query(User).first()
        if not user:
            print("No user found — register first.")
            return

        org_id = user.organization_id
        created = updated = 0

        for data in ASSETS:
            existing = db.query(Asset).filter(
                Asset.organization_id == org_id,
                Asset.name == data["name"],
            ).first()

            if existing:
                for k, v in data.items():
                    setattr(existing, k, v)
                updated += 1
                print(f"  Updated : {data['name']}  ({data['latitude']}, {data['longitude']})")
            else:
                db.add(Asset(**data, created_by=user.id, organization_id=org_id))
                created += 1
                print(f"  Created : {data['name']}  ({data['latitude']}, {data['longitude']})")

        db.commit()
        print(f"\nDone. Created={created}, Updated={updated}")
    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
