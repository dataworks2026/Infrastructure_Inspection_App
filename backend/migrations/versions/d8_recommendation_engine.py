"""D-8: recommendation engine — 9 additive tables, no changes to existing schema

Revision ID: d8_recommendation_engine
Revises: d7_detection_review
Create Date: 2026-09-02

"""
from alembic import op
import sqlalchemy as sa

revision = "d8_recommendation_engine"
down_revision = "d7_detection_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendation_class_vocabulary",
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), primary_key=True),
        sa.Column("class_value", sa.Text(), primary_key=True),
        sa.Column("provisional", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "class_value = lower(trim(class_value)) AND class_value <> ''",
            name="ck_rec_vocab_normalized",
        ),
    )

    op.create_table(
        "recommendation_severities",
        sa.Column("severity", sa.SmallInteger(), primary_key=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.CheckConstraint("severity BETWEEN 1 AND 4", name="ck_rec_severity_range"),
    )

    op.create_table(
        "recommendation_priority_tiers",
        sa.Column("tier", sa.SmallInteger(), primary_key=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.CheckConstraint("tier BETWEEN 1 AND 3", name="ck_rec_tier_range"),
    )

    op.create_table(
        "recommendation_library_entries",
        sa.Column("entry_id", sa.String(36), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_latest", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("detection_class", sa.Text(), nullable=False),
        sa.Column("severity", sa.SmallInteger(), sa.ForeignKey("recommendation_severities.severity"), nullable=False),
        sa.Column("asset_type", sa.Text(), nullable=True),
        sa.Column("asset_id", sa.String(36), nullable=True),
        sa.Column("recommendation_text", sa.Text(), nullable=False),
        sa.Column("action_class", sa.Text(), nullable=False),
        sa.Column("derived_tier", sa.SmallInteger(), sa.ForeignKey("recommendation_priority_tiers.tier"), nullable=False),
        sa.Column("tier_override", sa.SmallInteger(), sa.ForeignKey("recommendation_priority_tiers.tier"), nullable=True),
        sa.Column("created_by", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("version >= 1", name="ck_rec_entry_version_positive"),
        sa.CheckConstraint(
            "detection_class = lower(trim(detection_class)) AND detection_class <> ''",
            name="ck_rec_entry_class_normalized",
        ),
        sa.CheckConstraint("trim(recommendation_text) <> ''", name="ck_rec_entry_text_not_blank"),
        sa.CheckConstraint("trim(action_class) <> ''", name="ck_rec_entry_action_class_not_blank"),
        sa.CheckConstraint(
            "asset_type IS NULL OR trim(asset_type) <> ''", name="ck_rec_entry_asset_type_not_blank"
        ),
        sa.CheckConstraint(
            "tier_override IS NULL OR tier_override <= derived_tier",
            name="ck_rec_entry_tier_override_not_less_urgent",
        ),
    )
    op.create_index("ix_rec_library_entries_org", "recommendation_library_entries", ["organization_id"])

    op.create_table(
        "recommendation_audit_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("actor", sa.String(255), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        sa.Column("entity_version", sa.Integer(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("trim(actor) <> ''", name="ck_rec_audit_actor_not_blank"),
        sa.CheckConstraint("trim(action) <> ''", name="ck_rec_audit_action_not_blank"),
    )
    op.create_index("ix_rec_audit_events_org", "recommendation_audit_events", ["organization_id"])

    op.create_table(
        "recommendation_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("inspection_id", sa.String(36), sa.ForeignKey("inspections.id"), nullable=True),
        sa.Column("rollup_scope", sa.Text(), nullable=False),
        sa.Column("total_detections", sa.Integer(), nullable=False),
        sa.Column("total_matched", sa.Integer(), nullable=False),
        sa.Column("total_unmatched", sa.Integer(), nullable=False),
        sa.Column("total_dismissed", sa.Integer(), nullable=False),
        sa.Column("total_skipped", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("skipped_manifest", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("rollup_scope IN ('image', 'asset', 'inspection')", name="ck_rec_run_scope_valid"),
    )
    op.create_index("ix_rec_runs_org", "recommendation_runs", ["organization_id"])
    op.create_index("ix_rec_runs_inspection", "recommendation_runs", ["inspection_id"])

    op.create_table(
        "recommendation_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'Draft'")),
        sa.Column("matched_entry_id", sa.String(36), nullable=True),
        sa.Column("matched_entry_version", sa.Integer(), nullable=True),
        sa.Column("rollup_scope", sa.Text(), nullable=False),
        sa.Column("scope_key", sa.Text(), nullable=False),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("recommendation_runs.id"), nullable=False),
        sa.Column("supersedes_record_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["matched_entry_id", "matched_entry_version"],
            ["recommendation_library_entries.entry_id", "recommendation_library_entries.version"],
            name="fk_rec_record_matched_entry",
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_record_id"], ["recommendation_records.id"], name="fk_rec_record_supersedes",
        ),
        sa.CheckConstraint(
            "status IN ('Draft', 'Approved', 'Rejected', 'Needs Recommendation', 'Superseded')",
            name="ck_rec_record_status_valid",
        ),
        sa.CheckConstraint("rollup_scope IN ('image', 'asset', 'inspection')", name="ck_rec_record_scope_valid"),
        sa.CheckConstraint(
            "(status = 'Needs Recommendation' AND matched_entry_id IS NULL AND matched_entry_version IS NULL) "
            "OR (status <> 'Needs Recommendation' AND matched_entry_id IS NOT NULL AND matched_entry_version IS NOT NULL)",
            name="ck_rec_record_entry_required_unless_unmatched",
        ),
    )
    op.create_index("ix_rec_records_org", "recommendation_records", ["organization_id"])
    op.create_index("ix_rec_records_scope_key", "recommendation_records", ["scope_key"])
    op.create_index("ix_rec_records_run", "recommendation_records", ["run_id"])

    op.create_table(
        "recommendation_detection_links",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("record_id", sa.String(36), sa.ForeignKey("recommendation_records.id"), nullable=False),
        sa.Column("detection_id", sa.String(36), sa.ForeignKey("detections.id"), nullable=False),
        sa.Column("chain_key", sa.String(36), nullable=False),
        sa.Column("severity_at_generation", sa.SmallInteger(), nullable=False),
        sa.Column("detection_class", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("location", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("record_id", "detection_id", name="uq_rec_link_record_detection"),
        sa.CheckConstraint("severity_at_generation BETWEEN 1 AND 4", name="ck_rec_link_severity_range"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_rec_link_confidence_range"),
    )
    op.create_index("ix_rec_links_org", "recommendation_detection_links", ["organization_id"])
    op.create_index("ix_rec_links_record", "recommendation_detection_links", ["record_id"])
    op.create_index("ix_rec_links_chain_key", "recommendation_detection_links", ["chain_key"])

    op.create_table(
        "recommendation_report_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.organization_id"), nullable=True),
        sa.Column("inspection_id", sa.String(36), sa.ForeignKey("inspections.id"), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("generated_by", sa.String(255), nullable=True),
        sa.Column("issued_file_hash", sa.String(64), nullable=True),
        sa.Column("record_snapshot", sa.JSON(), nullable=False),
        sa.CheckConstraint(
            "issued_file_hash IS NULL OR length(issued_file_hash) = 64", name="ck_rec_snapshot_hash_len"
        ),
    )
    op.create_index("ix_rec_snapshots_org", "recommendation_report_snapshots", ["organization_id"])
    op.create_index("ix_rec_snapshots_inspection", "recommendation_report_snapshots", ["inspection_id"])

    # --- Seed the two fixed lookup tables ---
    op.bulk_insert(
        sa.table(
            "recommendation_severities",
            sa.column("severity", sa.SmallInteger()),
            sa.column("label", sa.Text()),
        ),
        [
            {"severity": 1, "label": "S1"},
            {"severity": 2, "label": "S2"},
            {"severity": 3, "label": "S3"},
            {"severity": 4, "label": "S4"},
        ],
    )
    op.bulk_insert(
        sa.table(
            "recommendation_priority_tiers",
            sa.column("tier", sa.SmallInteger()),
            sa.column("label", sa.Text()),
        ),
        [
            {"tier": 1, "label": "Immediate action"},
            {"tier": 2, "label": "Planned repair"},
            {"tier": 3, "label": "Monitor and maintain"},
        ],
    )

    # --- DB-enforced guards (Postgres only — the trigger functions use
    # plpgsql; on sqlite dev/test these three statements are skipped and
    # the app-side dual-enforcement checks in services.py carry the rule
    # alone, same as Tahya's original dual-enforcement design intended for
    # any non-Postgres environment) ---
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            CREATE OR REPLACE FUNCTION recommendation_audit_events_append_only()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'recommendation_audit_events is append only, % is not allowed', TG_OP;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_rec_audit_events_append_only ON recommendation_audit_events;
            CREATE TRIGGER trg_rec_audit_events_append_only
            BEFORE UPDATE OR DELETE ON recommendation_audit_events
            FOR EACH ROW EXECUTE FUNCTION recommendation_audit_events_append_only();
            """
        )

        # MAT-3: two active entries can't share a rule key. Coalesce
        # nulls to empty string first — Postgres treats every null as
        # distinct from every other null, which a plain unique index
        # would miss for two unscoped entries.
        op.execute(
            """
            DROP INDEX IF EXISTS uq_rec_entry_active_rule_key;
            CREATE UNIQUE INDEX uq_rec_entry_active_rule_key ON recommendation_library_entries (
                coalesce(organization_id, ''),
                detection_class,
                severity,
                coalesce(asset_type, ''),
                coalesce(asset_id, '')
            ) WHERE is_active AND is_latest;
            """
        )

        # DAT-5: the link set of a dispositioned record is immutable.
        op.execute(
            """
            CREATE OR REPLACE FUNCTION recommendation_links_immutable_once_dispositioned()
            RETURNS trigger AS $$
            DECLARE
                record_status text;
            BEGIN
                SELECT status INTO record_status FROM recommendation_records
                WHERE id = COALESCE(NEW.record_id, OLD.record_id);

                IF record_status IN ('Approved', 'Rejected') THEN
                    RAISE EXCEPTION 'the link set of a dispositioned record is immutable (status: %)', record_status;
                END IF;

                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_rec_links_immutable_once_dispositioned ON recommendation_detection_links;
            CREATE TRIGGER trg_rec_links_immutable_once_dispositioned
            BEFORE INSERT OR DELETE ON recommendation_detection_links
            FOR EACH ROW EXECUTE FUNCTION recommendation_links_immutable_once_dispositioned();
            """
        )
    else:
        # SQLite side of MAT-3. asset_type/asset_id are coalesced to ''
        # for the same reason the Postgres branch above coalesces them:
        # a plain index treats every NULL as distinct from every other
        # NULL, which would let two fully-unscoped active entries with
        # the same class+severity both exist -- verified by hand against
        # SQLite directly (a plain-column partial index silently let a
        # duplicate unscoped pair through; the coalesced version rejects
        # it). Mirrors the Index already declared on the model so
        # create_all() (dev/test) and this migration (real dev/prod)
        # produce the identical constraint.
        #
        # Two separate statements -- SQLite's DBAPI cursor only accepts
        # one statement per execute() call, unlike psycopg2 above.
        op.execute("DROP INDEX IF EXISTS uq_rec_entry_active_rule_key_sqlite")
        op.execute(
            """
            CREATE UNIQUE INDEX uq_rec_entry_active_rule_key_sqlite ON recommendation_library_entries (
                organization_id,
                detection_class,
                severity,
                coalesce(asset_type, ''),
                coalesce(asset_id, '')
            ) WHERE is_active AND is_latest
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_rec_links_immutable_once_dispositioned ON recommendation_detection_links")
        op.execute("DROP FUNCTION IF EXISTS recommendation_links_immutable_once_dispositioned")
        op.execute("DROP INDEX IF EXISTS uq_rec_entry_active_rule_key")
        op.execute("DROP TRIGGER IF EXISTS trg_rec_audit_events_append_only ON recommendation_audit_events")
        op.execute("DROP FUNCTION IF EXISTS recommendation_audit_events_append_only")

    op.drop_table("recommendation_report_snapshots")
    op.drop_table("recommendation_detection_links")
    op.drop_table("recommendation_records")
    op.drop_table("recommendation_runs")
    op.drop_table("recommendation_audit_events")
    op.drop_table("recommendation_library_entries")
    op.drop_table("recommendation_priority_tiers")
    op.drop_table("recommendation_severities")
    op.drop_table("recommendation_class_vocabulary")
