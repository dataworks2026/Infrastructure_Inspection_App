"""
Shared pytest fixtures for the analytics test suites.

Fixtures provide:
- A fresh in-memory SQLite engine + session per test (no real DB
  is ever touched)
- A pre-seeded test organization + test user
- A FastAPI TestClient with get_db / get_current_user overridden
  to point at the in-memory session and test user
- A small helper to seed an asset + N inspections + detections
  in one call so individual tests stay short
"""

from __future__ import annotations

# Force the app to load with an in-memory DB before any app.* import
# is triggered transitively. The Pydantic settings singleton caches
# DATABASE_URL on first read, so setting it later has no effect.
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import sys
import uuid
from datetime import date

# Make sure "app.*" resolves regardless of which directory pytest
# is invoked from.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

import pytest
from fastapi.testclient   import TestClient
from sqlalchemy           import create_engine
from sqlalchemy.orm       import sessionmaker
from sqlalchemy.pool      import StaticPool

from app.core.deps        import get_db, get_current_user
from app.core.security    import hash_password
from app.database         import Base
# Alias the FastAPI app to avoid shadowing the "app" package import
# below — every model module is loaded via "import app.models".
from app.main             import app as fastapi_app
import app.models  # noqa: F401 — registers every model on Base

from app.models.asset        import Asset
from app.models.detection    import Detection
from app.models.image        import Image
from app.models.inspection   import Inspection
from app.models.organization import Organization
from app.models.user         import User


# ─── DB fixtures ──────────────────────────────────────────────────

@pytest.fixture
def db_engine():
    """Fresh in-memory SQLite engine per test — every test starts
    from a clean schema.

    StaticPool is required because SQLite ``:memory:`` databases are
    per-connection. FastAPI's TestClient runs requests on a worker
    thread; without StaticPool each request would get a brand-new
    empty in-memory DB instead of the one our fixture seeded."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine):
    # expire_on_commit=False so ORM-loaded objects (e.g. test_user)
    # stay readable across multiple API calls in the same test
    # without triggering a lazy-reload from a stale session.
    Session  = sessionmaker(
        bind=db_engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )
    session  = Session()
    try:
        yield session
    finally:
        session.close()


# ─── Org / user fixtures ──────────────────────────────────────────

@pytest.fixture
def test_org(db_session):
    org = Organization(
        organization_id = "test-org-1",
        name            = "Test Org",
        slug            = "test-org-1",
    )
    db_session.add(org)
    db_session.commit()
    return org


@pytest.fixture
def other_org(db_session):
    """A SECOND organization, used by tests that verify cross-org
    isolation. Should never be returned to the test_user."""
    org = Organization(
        organization_id = "other-org-1",
        name            = "Other Org",
        slug            = "other-org-1",
    )
    db_session.add(org)
    db_session.commit()
    return org


@pytest.fixture
def test_user(db_session, test_org):
    user = User(
        id              = "test-user-1",
        organization_id = test_org.organization_id,
        email           = "test@example.com",
        full_name       = "Test User",
        hashed_password = hash_password("testpass"),
        role            = "analyst",
        is_active       = True,
    )
    db_session.add(user)
    db_session.commit()
    return user


# ─── HTTP client with auth + DB overrides ─────────────────────────

@pytest.fixture
def client(db_session, test_user):
    """FastAPI TestClient routed against the in-memory DB and the
    test user. Dependency overrides are cleared on teardown so a
    failure in one test does not leak into the next."""
    def _get_db():
        try:
            yield db_session
        finally:
            pass

    def _get_current_user():
        return test_user

    fastapi_app.dependency_overrides[get_db]           = _get_db
    fastapi_app.dependency_overrides[get_current_user] = _get_current_user
    try:
        yield TestClient(fastapi_app)
    finally:
        fastapi_app.dependency_overrides.clear()


@pytest.fixture
def unauthed_client(db_session):
    """TestClient without get_current_user override — used by tests
    that exercise the 401 path."""
    def _get_db():
        try:
            yield db_session
        finally:
            pass

    fastapi_app.dependency_overrides[get_db] = _get_db
    try:
        yield TestClient(fastapi_app)
    finally:
        fastapi_app.dependency_overrides.clear()


# ─── Seeding helpers ──────────────────────────────────────────────

def seed_asset(
    db,
    *,
    asset_id            : str,
    organization_id     : str,
    name                : str,
    infrastructure_type : str = "coastal",
) -> Asset:
    asset = Asset(
        id                  = asset_id,
        organization_id     = organization_id,
        name                = name,
        infrastructure_type = infrastructure_type,
        status              = "active",
    )
    db.add(asset)
    db.commit()
    return asset


def seed_inspection(
    db,
    *,
    asset_id        : str,
    organization_id : str,
    inspection_date : date,
    severity        : str | None = "S2",
    inspected_at    = None,
):
    """Seed one completed Inspection + Image + Detection for an asset.

    Pass severity=None to seed a detection with NULL severity (used
    by tests that verify the data adapter filters those out).
    Pass inspection_date=None to use only inspected_at (DATETIME).
    """
    insp_id = str(uuid.uuid4())
    img_id  = str(uuid.uuid4())
    db.add(Inspection(
        id              = insp_id,
        organization_id = organization_id,
        asset_id        = asset_id,
        inspection_date = inspection_date,
        inspected_at    = inspected_at,
        status          = "completed",
        name            = f"Inspection {inspection_date or inspected_at}",
        inspector_name  = "Test Inspector",
    ))
    db.add(Image(
        id              = img_id,
        organization_id = organization_id,
        inspection_id   = insp_id,
        filename        = "test.jpg",
        upload_completed= True,
        analysis_status = "completed",
    ))
    db.add(Detection(
        image_id        = img_id,
        organization_id = organization_id,
        severity        = severity,
        damage_type     = "corrosion",
    ))
    db.commit()
    return insp_id
