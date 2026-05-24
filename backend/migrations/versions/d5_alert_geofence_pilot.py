"""D-5: alert, geofence, pilot tables

Revision ID: d5_alert_geofence_pilot
Revises: d4_drone_fleet
Create Date: 2026-05-21

"""
from alembic import op
import sqlalchemy as sa

revision = "d5_alert_geofence_pilot"
down_revision = "d4_drone_fleet"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pilots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("initials", sa.String(10), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("license_kind", sa.String(20), nullable=False),
        sa.Column("license_number", sa.String(100), nullable=False),
        sa.Column("license_expires_at", sa.DateTime, nullable=False),
        sa.Column("insurance_carrier", sa.String(255), nullable=True),
        sa.Column("insurance_coverage_usd", sa.Float, nullable=True),
        sa.Column("insurance_active_until", sa.DateTime, nullable=True),
        sa.Column("role", sa.String(20), nullable=False, server_default="pilot"),
        sa.Column("active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_pilots_user_id"),
    )
    op.create_index("ix_pilots_email", "pilots", ["email"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tone", sa.String(10), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("action_label", sa.String(255), nullable=False),
        sa.Column("action_href", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("acknowledged_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"])

    op.create_table(
        "geofences",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("site_id", sa.String(36), nullable=True),
        sa.Column("polygon", sa.JSON, nullable=False),
        sa.Column("max_alt_agl", sa.Float, nullable=False),
        sa.Column("no_fly_zones", sa.JSON, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("geofences")
    op.drop_index("ix_alerts_created_at", "alerts")
    op.drop_table("alerts")
    op.drop_index("ix_pilots_email", "pilots")
    op.drop_table("pilots")
