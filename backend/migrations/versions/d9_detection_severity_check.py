"""D-9: detections.severity restricted to S1 to S4 (nullable stays)

Revision ID: d9_detection_severity_check
Revises: d8_recommendation_engine
Create Date: 2026-09-25

CTO decision 2026-09-24 (issue #16): an out of domain severity must not be
able to enter the table. Production holds only S1 to S4 and NULL today
(2,979 rows checked 2026-09-09), so the constraint applies cleanly. NULL is
allowed until the write paths have been checked.
"""
import sqlalchemy as sa
from alembic import op

revision = "d9_detection_severity_check"
down_revision = "d8_recommendation_engine"
branch_labels = None
depends_on = None

CONSTRAINT = "ck_detections_severity_domain"
CONDITION = "severity IS NULL OR severity IN ('S1', 'S2', 'S3', 'S4')"


def _already_present(bind) -> bool:
    # The Detection model declares this same constraint, so a database whose
    # detections table was bootstrapped by create_all (SQLite development,
    # the CI test database, a fresh install through the entrypoint) already
    # has it; production, created before the model carried it, does not.
    names = {c["name"] for c in sa.inspect(bind).get_check_constraints("detections")}
    return CONSTRAINT in names


def upgrade() -> None:
    bind = op.get_bind()
    if _already_present(bind):
        return
    if bind.dialect.name == "sqlite":
        # SQLite cannot add a constraint to an existing table without a
        # rebuild; batch mode does that rebuild for development databases.
        with op.batch_alter_table("detections") as batch:
            batch.create_check_constraint(CONSTRAINT, CONDITION)
    else:
        op.create_check_constraint(CONSTRAINT, "detections", CONDITION)


def downgrade() -> None:
    bind = op.get_bind()
    if not _already_present(bind):
        return
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("detections") as batch:
            batch.drop_constraint(CONSTRAINT, type_="check")
    else:
        op.drop_constraint(CONSTRAINT, "detections", type_="check")
