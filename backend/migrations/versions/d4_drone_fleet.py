"""D-4: drone fleet table

Revision ID: d4_drone_fleet
Revises:
Create Date: 2026-05-21

"""
from alembic import op
import sqlalchemy as sa

revision = "d4_drone_fleet"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drones",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("serial", sa.String(100), nullable=False),
        sa.Column("model", sa.String(50), nullable=False),
        sa.Column("fw_version", sa.String(50), nullable=True),
        sa.Column("bay", sa.String(255), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="idle"),
        sa.Column("current_mission_id", sa.String(36), nullable=True),
        sa.Column("battery_pct", sa.Float, nullable=True),
        sa.Column("battery_voltage", sa.Float, nullable=True),
        sa.Column("battery_temp_c", sa.Float, nullable=True),
        sa.Column("battery_cycles", sa.Integer, nullable=True),
        sa.Column("battery_pack", sa.String(50), nullable=True),
        sa.Column("capabilities_lenses", sa.JSON, nullable=True),
        sa.Column("capabilities_max_flight_time_min", sa.Float, nullable=True),
        sa.Column("capabilities_max_alt_agl", sa.Float, nullable=True),
        sa.Column("last_seen_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("serial", name="uq_drones_serial"),
    )


def downgrade() -> None:
    op.drop_table("drones")
