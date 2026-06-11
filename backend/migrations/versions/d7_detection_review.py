"""D-7: engineer review flow — detections source/is_locked + detection_reviews table

Revision ID: d7_detection_review
Revises: d6_mission_record
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "d7_detection_review"
down_revision = "d6_mission_record"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend detections — server_default backfills existing rows
    op.add_column(
        "detections",
        sa.Column("source", sa.String(20), nullable=False, server_default="cv_model"),
    )
    op.add_column(
        "detections",
        sa.Column("is_locked", sa.Boolean, nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "detection_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("images.id", ondelete="CASCADE"), nullable=False),
        sa.Column("inspection_id", sa.String(36), sa.ForeignKey("inspections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cv_detection_id", sa.String(36), sa.ForeignKey("detections.id"), nullable=True),  # NULL when action='added'
        sa.Column("engineer_detection_id", sa.String(36), sa.ForeignKey("detections.id"), nullable=True),  # NULL when 'rejected'/'accepted'
        sa.Column("action", sa.String(20), nullable=False),  # 'accepted' | 'rejected' | 'modified' | 'added'
        sa.Column("delta_json", sa.JSON, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("reviewed_by", sa.String(255), nullable=True),
        sa.Column("reviewed_at", sa.DateTime, server_default=sa.func.now(), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_detection_reviews_image_id", "detection_reviews", ["image_id"])
    op.create_index("ix_detection_reviews_inspection_id", "detection_reviews", ["inspection_id"])
    op.create_index("ix_detection_reviews_cv_detection_id", "detection_reviews", ["cv_detection_id"])
    op.create_index("ix_detection_reviews_action", "detection_reviews", ["action"])


def downgrade() -> None:
    op.drop_index("ix_detection_reviews_action", "detection_reviews")
    op.drop_index("ix_detection_reviews_cv_detection_id", "detection_reviews")
    op.drop_index("ix_detection_reviews_inspection_id", "detection_reviews")
    op.drop_index("ix_detection_reviews_image_id", "detection_reviews")
    op.drop_table("detection_reviews")
    op.drop_column("detections", "is_locked")
    op.drop_column("detections", "source")
