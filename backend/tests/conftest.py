"""
Shared pytest fixtures for the analytics test suites.

Fixtures provide:
- A database engine + session per test. With no DATABASE_URL set this
  is a fresh in-memory SQLite database per test (no real DB is ever
  touched). When DATABASE_URL points at PostgreSQL, as it does in CI,
  the suite runs against that database instead: the schema is built
  once per session the same way the container entrypoint builds it
  (create_all for the pre-Alembic tables, stamp d7, alembic upgrade
  head), so migration-owned constructs such as triggers and partial
  indexes are present, and every table is truncated between tests.
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


def _assert_disposable_test_database(url: str) -> None:
    """Refuse to run the Postgres test path against anything that is not
    a local, throwaway database. The fixture below drops and rebuilds the
    whole public schema and truncates every table between tests; pointed
    at a real database it would destroy it. Production and staging are
    reached only through the backend service account and only via alembic
    (handover section L, deployment procedure), never from a test run."""
    from sqlalchemy.engine import make_url

    u = make_url(url)
    host = (u.host or "").lower()
    name = u.database or ""
    problems = []
    if host not in ("localhost", "127.0.0.1", "::1", "postgres"):
        problems.append(f"host {host!r} is not local")
    if "rds.amazonaws.com" in host or "miraintel" in host:
        problems.append("host looks like a managed or company database")
    if not name.endswith("_test"):
        problems.append(f"database name {name!r} does not end with _test")
    if problems:
        raise RuntimeError(
            "Refusing to run the test suite against DATABASE_URL: " + "; ".join(problems) + ". "
            "The Postgres test path drops and rebuilds the schema. Point DATABASE_URL at a local "
            "disposable database whose name ends with _test (CI uses postgresql://mira:mira@localhost:5432/mira_test), "
            "or unset it to use in-memory SQLite."
        )


if os.environ["DATABASE_URL"].startswith("postgresql"):
    _assert_disposable_test_database(os.environ["DATABASE_URL"])

# Disable the LightGBM forecast model in the test suite.
# The native LightGBM scheduler conflicts with pytest's threading on
# some platforms (macOS) and causes a segfault. The analytics pipeline
# runs fully; forecast columns come back as None (graceful degradation).
# Production and Linux CI are unaffected — they never set this flag.
os.environ.setdefault("MIRA_DISABLE_FORECAST", "1")

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
from sqlalchemy           import create_engine, text
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

_TEST_DATABASE_URL = os.environ["DATABASE_URL"]
_ON_POSTGRES       = _TEST_DATABASE_URL.startswith("postgresql")

# Tables the migrations seed or own; never truncated between tests.
_MIGRATION_OWNED_PREFIX = "recommendation_"
_KEEP_BETWEEN_TESTS     = {"alembic_version", "recommendation_severities", "recommendation_priority_tiers"}


def _build_postgres_schema(engine):
    """Rebuild the test database from nothing, exactly as the container
    entrypoint does for a fresh install: pre-Alembic tables via
    create_all, stamp d7, then the migrations from d8 on. Importing
    app.main has already run create_all against this database, which
    would leave migration-owned tables without their triggers, so the
    schema is dropped first."""
    from alembic import command
    from alembic.config import Config

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    bootstrap = [t for t in Base.metadata.sorted_tables if not t.name.startswith(_MIGRATION_OWNED_PREFIX)]
    Base.metadata.create_all(engine, tables=bootstrap)

    cfg = Config(os.path.join(_BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(_BACKEND_DIR, "migrations"))
    command.stamp(cfg, "d7_detection_review")
    command.upgrade(cfg, "head")


def _truncate_everything(engine):
    names = [t.name for t in Base.metadata.sorted_tables if t.name not in _KEEP_BETWEEN_TESTS]
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE " + ", ".join(names) + " RESTART IDENTITY CASCADE"))


@pytest.fixture(scope="session")
def _postgres_engine():
    _assert_disposable_test_database(_TEST_DATABASE_URL)
    engine = create_engine(_TEST_DATABASE_URL, echo=False)
    _build_postgres_schema(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db_engine(request):
    """One clean database per test.

    SQLite (default, local development): a fresh in-memory engine.
    StaticPool is required because SQLite ``:memory:`` databases are
    per-connection. FastAPI's TestClient runs requests on a worker
    thread; without StaticPool each request would get a brand-new
    empty in-memory DB instead of the one our fixture seeded.

    PostgreSQL (DATABASE_URL in CI): the session-scoped engine whose
    schema came from the migrations, truncated before the test."""
    if _ON_POSTGRES:
        engine = request.getfixturevalue("_postgres_engine")
        _truncate_everything(engine)
        yield engine
        return

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
