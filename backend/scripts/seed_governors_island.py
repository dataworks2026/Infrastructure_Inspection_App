"""
Seed script: Governor's Island infrastructure assets.
Run from backend/ directory:
  python scripts/seed_governors_island.py

Requires DATABASE_URL in environment or backend/.env
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.asset import Asset
from app.models.user import User

ASSETS = [
    {
        "name": "Soissons Landing",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island, North Ferry Terminal",
        "latitude": 40.6929,
        "longitude": -74.0203,
        "status": "active",
    },
    {
        "name": "South Battery Pier",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island, South Waterfront",
        "latitude": 40.6866,
        "longitude": -74.0145,
        "status": "active",
    },
    {
        "name": "East Seawall",
        "infrastructure_type": "coastal",
        "location_name": "Governor's Island, East Shoreline",
        "latitude": 40.6903,
        "longitude": -74.0128,
        "status": "active",
    },
    {
        "name": "South Battery Seawall",
        "infrastructure_type": "coastal",
        "location_name": "Governor's Island, South Battery",
        "latitude": 40.6868,
        "longitude": -74.0173,
        "status": "maintenance",
    },
    {
        "name": "Yankee Pier",
        "infrastructure_type": "pier",
        "location_name": "Governor's Island, Southwest Dock",
        "latitude": 40.6872,
        "longitude": -74.0188,
        "status": "active",
    },
    {
        "name": "North Breakwater",
        "infrastructure_type": "coastal",
        "location_name": "Governor's Island, North Shore",
        "latitude": 40.6935,
        "longitude": -74.0165,
        "status": "active",
    },
]


def seed():
    db = SessionLocal()
    try:
        # Get the first org/user to assign assets to
        user = db.query(User).first()
        if not user:
            print("No user found. Create a user first via /register.")
            return

        org_id = user.organization_id
        created = 0
        skipped = 0

        for data in ASSETS:
            existing = db.query(Asset).filter(
                Asset.organization_id == org_id,
                Asset.name == data["name"],
            ).first()

            if existing:
                # Update coordinates
                existing.latitude = data["latitude"]
                existing.longitude = data["longitude"]
                existing.location_name = data["location_name"]
                existing.infrastructure_type = data["infrastructure_type"]
                existing.status = data["status"]
                skipped += 1
                print(f"  Updated: {data['name']}")
            else:
                asset = Asset(
                    **data,
                    created_by=user.id,
                    organization_id=org_id,
                )
                db.add(asset)
                created += 1
                print(f"  Created: {data['name']}")

        db.commit()
        print(f"\nDone. Created={created}, Updated={skipped}")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
