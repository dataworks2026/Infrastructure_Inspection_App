"""D-6: mission_records immutable post-flight table

Revision ID: d6_mission_record
Revises: d5_alert_geofence_pilot
Create Date: 2026-05-21

"""
from alembic import op
import sqlalchemy as sa

revision = "d6_mission_record"
down_revision = "d5_alert_geofence_pilot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mission_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("plan_snapshot", sa.JSON, nullable=False),
        sa.Column("flown_at_start", sa.DateTime, nullable=False),
        sa.Column("flown_at_end", sa.DateTime, nullable=False),
        sa.Column("drone_id", sa.String(20), sa.ForeignKey("drones.id"), nullable=False),
        sa.Column("pilot_id", sa.String(36), sa.ForeignKey("pilots.id"), nullable=False),
        sa.Column("mission_id", sa.String(36), nullable=True),  # soft ref
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("reason_if_not_complete", sa.Text, nullable=True),
        sa.Column("stats_duration_sec", sa.Integer, nullable=False),
        sa.Column("stats_total_distance_m", sa.Float, nullable=False),
        sa.Column("stats_max_alt_agl", sa.Float, nullable=False),
        sa.Column("stats_avg_speed", sa.Float, nullable=False),
        sa.Column("stats_max_speed", sa.Float, nullable=False),
        sa.Column("stats_battery_start_pct", sa.Float, nullable=False),
        sa.Column("stats_battery_end_pct", sa.Float, nullable=False),
        sa.Column("stats_photos_planned", sa.Integer, nullable=False),
        sa.Column("stats_photos_captured", sa.Integer, nullable=False),
        sa.Column("stats_data_mb", sa.Float, nullable=False),
        sa.Column("stats_plan_deviation_max_m", sa.Float, nullable=False),
        sa.Column("telemetry_uri", sa.String(500), nullable=True),
        sa.Column("telemetry_inline", sa.JSON, nullable=True),
        sa.Column("captures_json", sa.JSON, nullable=True),
        sa.Column("events_json", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        # No updated_at — immutable record
    )
    op.create_index("ix_mission_records_drone_id", "mission_records", ["drone_id"])
    op.create_index("ix_mission_records_pilot_id", "mission_records", ["pilot_id"])


def downgrade() -> None:
    op.drop_index("ix_mission_records_pilot_id", "mission_records")
    op.drop_index("ix_mission_records_drone_id", "mission_records")
    op.drop_table("mission_records")
