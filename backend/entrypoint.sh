#!/bin/sh
# Migrations run before the application boots. main.py still calls
# Base.metadata.create_all at startup, so without this step a fresh
# container could create migration-owned tables (d8 onward) before their
# migration ran, without the triggers and indexes only the migration adds,
# and the later upgrade would then fail on "already exists".
#
# A database with no alembic_version table is a fresh install: the
# pre-Alembic tables are bootstrapped with create_all, the chain is
# stamped at d7 (the last revision whose tables create_all owns), and
# upgrade then applies d8 onward the same way it does everywhere else.
set -e

python - <<'PY'
import subprocess
import sys

from sqlalchemy import inspect

from app.database import Base, engine
import app.models  # noqa: F401  registers every model on Base.metadata

MIGRATION_OWNED_PREFIX = "recommendation_"

if not inspect(engine).has_table("alembic_version"):
    bootstrap = [t for t in Base.metadata.sorted_tables if not t.name.startswith(MIGRATION_OWNED_PREFIX)]
    Base.metadata.create_all(bind=engine, tables=bootstrap)
    subprocess.run([sys.executable, "-m", "alembic", "stamp", "d7_detection_review"], check=True)
PY

python -m alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
