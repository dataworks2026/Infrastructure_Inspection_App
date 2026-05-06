"""
Local demo seed for the predictive analytics feature.

Creates a small, deterministic dataset in a local SQLite file so
you can click through the /analytics page end-to-end without
touching any real database.

Seeds:
  - 1 organization + 1 user (login with the printed credentials)
  - 6 assets spanning the main infrastructure types, each with
    3 to 5 completed inspections and matching detections at
    varying severities. Trends include worsening, improving,
    accelerating, stable, fluctuating, and an anomaly jump.

Usage:
    # Run against a throwaway file, not the real dev DB
    cd backend
    DATABASE_URL=sqlite:///./mira_intel_analytics_demo.db \
    python scripts/seed_predictive_demo.py

To reset, simply delete the .db file and re-run. The script is
also idempotent — if the same user email already exists it
will abort early so you cannot accidentally double-seed.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import date
from typing import Iterable

# Allow "python backend/scripts/seed_predictive_demo.py" from any cwd.
_THIS_DIR    = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.abspath(os.path.join(_THIS_DIR, ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.core.config  import settings
from app.core.security import hash_password
import app.models  # noqa: F401 — registers every model on Base

from app.models.asset        import Asset
from app.models.detection    import Detection
from app.models.image        import Image
from app.models.inspection   import Inspection
from app.models.organization import Organization
from app.models.user         import User


DEMO_EMAIL    = "demo@miraintel.com"
DEMO_PASSWORD = "analytics123"
DEMO_ORG_NAME = "Mira Intel Demo"


def _guard_safe_database() -> None:
    """Abort immediately if DATABASE_URL points anywhere other than
    a local SQLite file. Belt-and-braces so this seed cannot write
    to production by mistake."""
    url = settings.DATABASE_URL.lower()
    if "sqlite" not in url:
        raise RuntimeError(
            "seed_predictive_demo.py refuses to run against a "
            "non-sqlite DATABASE_URL. Current value: "
            f"{settings.DATABASE_URL!r}. "
            "Set DATABASE_URL=sqlite:///./mira_intel_analytics_demo.db "
            "before running."
        )


# ── seed data definitions ─────────────────────────────────────────

# asset_id, asset_name, infrastructure_type, [(yyyy, mm, dd, 'SN'), ...]
#   — one tuple per inspection. Severity is a string the data_adapter
#     expects to see on Detection.severity ("S1".."S4").
ASSET_SEEDS: list[tuple[str, str, str, list[tuple[int, int, int, str]]]] = [
    ("A01", "Sault Ste Marie Lock Wall", "coastal", [
        (2024, 4, 20, "S2"),
        (2024, 11, 23, "S4"),   # anomaly jump 2 -> 4
        (2025, 1, 10, "S4"),
        (2025, 11, 7, "S4"),
        (2026, 2, 23, "S4"),
    ]),
    ("A02", "Bayport Container Dock 2", "pier", [
        (2024, 4, 3, "S4"),
        (2024, 12, 1, "S3"),
        (2025, 5, 26, "S3"),
        (2025, 7, 19, "S3"),
        (2025, 12, 10, "S3"),
    ]),
    ("A03", "Bay Bridge E-Span Pier W2", "bridge", [
        (2024, 4, 4, "S3"),
        (2024, 4, 23, "S4"),
        (2024, 6, 9, "S3"),
        (2025, 6, 7, "S4"),
        (2025, 8, 7, "S3"),
    ]),
    ("A04", "East Breakwater", "breakwater", [
        (2024, 2, 19, "S4"),
        (2024, 7, 14, "S4"),
        (2024, 12, 21, "S4"),
        (2025, 3, 9, "S4"),
    ]),
    ("A05", "Golden Gate South Tower", "bridge", [
        (2024, 4, 16, "S4"),
        (2024, 7, 10, "S4"),
        (2025, 9, 20, "S3"),
        (2025, 10, 14, "S3"),
    ]),
    ("A06", "Turbine Alpha-7", "wind_turbine", [
        (2024, 3, 15, "S1"),
        (2024, 9, 15, "S2"),
        (2025, 3, 15, "S3"),
    ]),
]


# ── helpers ───────────────────────────────────────────────────────

def _seed_inspection(
    db              : Session,
    organization_id : str,
    asset_id        : str,
    d               : date,
    severity        : str,
) -> None:
    insp_id = str(uuid.uuid4())
    img_id  = str(uuid.uuid4())

    db.add(Inspection(
        id              = insp_id,
        organization_id = organization_id,
        asset_id        = asset_id,
        inspection_date = d,
        status          = "completed",
        # InspectionResponse Pydantic schema requires a non-null
        # string here; a human-friendly default keeps GET
        # /api/v1/inspections from 500-ing.
        name            = f"Inspection {d.isoformat()}",
        inspector_name  = "Demo Inspector",
    ))
    db.add(Image(
        id              = img_id,
        organization_id = organization_id,
        inspection_id   = insp_id,
        filename        = f"{asset_id}_{d.isoformat()}.jpg",
        upload_completed= True,
        analysis_status = "completed",
    ))
    db.add(Detection(
        image_id        = img_id,
        organization_id = organization_id,
        severity        = severity,
        damage_type     = "corrosion",      # plausible placeholder
    ))


def _print_existing(label: str, rows: Iterable) -> None:
    rows = list(rows)
    if not rows:
        return
    print(f"  [{label}] {len(rows)} row(s) already present, skipping seed.")


# ── main ──────────────────────────────────────────────────────────

def main() -> int:
    _guard_safe_database()

    print(f"[seed] DATABASE_URL = {settings.DATABASE_URL}")
    print(f"[seed] Ensuring schema exists ...")
    Base.metadata.create_all(engine)

    db: Session = SessionLocal()
    try:
        # Idempotency guard.
        existing = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if existing is not None:
            print(
                f"[seed] User {DEMO_EMAIL!r} already exists — aborting to "
                "avoid duplicates. Delete the .db file and re-run to reset."
            )
            return 0

        org_id = str(uuid.uuid4())
        user_id = str(uuid.uuid4())

        print(f"[seed] Creating organization: {DEMO_ORG_NAME}")
        db.add(Organization(
            organization_id = org_id,
            name            = DEMO_ORG_NAME,
            slug            = "mira-intel-demo",
        ))

        print(f"[seed] Creating user:         {DEMO_EMAIL}")
        db.add(User(
            id              = user_id,
            organization_id = org_id,
            email           = DEMO_EMAIL,
            full_name       = "Demo User",
            hashed_password = hash_password(DEMO_PASSWORD),
            role            = "analyst",
            is_active       = True,
        ))

        print(f"[seed] Creating {len(ASSET_SEEDS)} assets + inspections ...")
        for asset_id, asset_name, infra, inspections in ASSET_SEEDS:
            db.add(Asset(
                id                  = asset_id,
                organization_id     = org_id,
                name                = asset_name,
                infrastructure_type = infra,
                status              = "active",
                created_by          = user_id,
            ))
            for (y, m, d, sev) in inspections:
                _seed_inspection(
                    db, org_id, asset_id, date(y, m, d), sev
                )

        db.commit()

        print()
        print("=" * 60)
        print(" Demo data seeded.")
        print("=" * 60)
        print(f" Login URL : http://localhost:3000/login")
        print(f" Email     : {DEMO_EMAIL}")
        print(f" Password  : {DEMO_PASSWORD}")
        print()
        print(" Seeded assets:")
        for asset_id, name, infra, inspections in ASSET_SEEDS:
            print(
                f"   {asset_id}  {name:30s} ({infra:12s}) "
                f"{len(inspections)} inspections"
            )
        print("=" * 60)
        return 0

    except Exception as exc:
        db.rollback()
        print(f"[seed] FAILED: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
