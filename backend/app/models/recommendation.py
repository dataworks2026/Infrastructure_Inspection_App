import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import JSON as JSONB

from app.database import Base


class RecommendationClassVocabulary(Base):
    # LE3 (Vocabulary), per-org. Observed, versioned class value set (DAT-1/OI-2).
    # provisional stays true until a real export is reviewed and baselined —
    # a manual decision; this table only makes sure that state is never lost.
    __tablename__ = "recommendation_class_vocabulary"

    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), primary_key=True)
    class_value = Column(Text, primary_key=True)
    provisional = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    source = Column(Text, nullable=False, default="fixture")
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "class_value = lower(trim(class_value)) AND class_value <> ''",
            name="ck_rec_vocab_normalized",
        ),
    )


class RecommendationSeverity(Base):
    # Fixed platform semantics (baseline §8.3 severity map) — not observed
    # data, so no provisional flag. Global lookup, not org-scoped.
    __tablename__ = "recommendation_severities"

    severity = Column(SmallInteger, primary_key=True)
    label = Column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("severity BETWEEN 1 AND 4", name="ck_rec_severity_range"),
    )


class RecommendationPriorityTier(Base):
    # OI-4, closed: 3 tiers, derived from severity. Global lookup.
    __tablename__ = "recommendation_priority_tiers"

    tier = Column(SmallInteger, primary_key=True)
    label = Column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("tier BETWEEN 1 AND 3", name="ck_rec_tier_range"),
    )


class RecommendationLibraryEntry(Base):
    # LE2 (Rule store). DAT-3: keyed on entry_id + version, so editing an
    # entry adds a row instead of overwriting one (LIB-5, copy-on-write).
    # is_active is entry-wide (every version shares it); is_latest marks
    # the single current version — older rows stay for history but are
    # excluded from matching once superseded.
    __tablename__ = "recommendation_library_entries"

    entry_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    version = Column(Integer, primary_key=True)

    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True, index=True)

    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    is_latest = Column(Boolean, nullable=False, default=True, server_default=text("true"))

    # rule key (LIB-2): class + severity mandatory, asset type + asset id
    # optional narrowing. class is normalized (trimmed, lowercased) before
    # it reaches here, and bound to the per-org vocabulary the same way
    # DAT-1 requires (enforced app-side, dual-enforcement pattern).
    detection_class = Column(Text, nullable=False)
    severity = Column(SmallInteger, ForeignKey("recommendation_severities.severity"), nullable=False)
    asset_type = Column(Text, nullable=True)
    asset_id = Column(String(36), nullable=True)

    recommendation_text = Column(Text, nullable=False)
    action_class = Column(Text, nullable=False)
    derived_tier = Column(SmallInteger, ForeignKey("recommendation_priority_tiers.tier"), nullable=False)
    tier_override = Column(SmallInteger, ForeignKey("recommendation_priority_tiers.tier"), nullable=True)

    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    archived_at = Column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_rec_entry_version_positive"),
        CheckConstraint(
            "detection_class = lower(trim(detection_class)) AND detection_class <> ''",
            name="ck_rec_entry_class_normalized",
        ),
        CheckConstraint("trim(recommendation_text) <> ''", name="ck_rec_entry_text_not_blank"),
        CheckConstraint("trim(action_class) <> ''", name="ck_rec_entry_action_class_not_blank"),
        CheckConstraint(
            "asset_type IS NULL OR trim(asset_type) <> ''", name="ck_rec_entry_asset_type_not_blank"
        ),
        # tier 1 is most urgent, 3 least — an override may only move toward
        # tier 1, never past what severity derived (upward-only override)
        CheckConstraint(
            "tier_override IS NULL OR tier_override <= derived_tier",
            name="ck_rec_entry_tier_override_not_less_urgent",
        ),
        # MAT-3, dev/test side: the same partial unique index the d8
        # migration installs, declared here too so create_all() (which
        # never runs the migration, and which app/main.py calls
        # unconditionally on every boot regardless of dialect) can't ever
        # produce an unconditional -- i.e. wrong -- unique index if it
        # somehow creates this table before a migration does. asset_type
        # and asset_id are coalesced to '' for the same reason the
        # Postgres migration coalesces them: a plain index treats every
        # NULL as distinct from every other NULL, which would let two
        # fully-unscoped active entries with the same class+severity
        # both exist -- confirmed by hand against SQLite directly, not
        # just assumed from the Postgres case. On Postgres this index is
        # a redundant safety net (the migration's own is authoritative);
        # on SQLite (the only place create_all() is the real schema
        # source) this is the sole DB-level backstop for MAT-3.
        Index(
            "uq_rec_entry_active_rule_key_sqlite",
            "organization_id",
            "detection_class",
            "severity",
            text("coalesce(asset_type, '')"),
            text("coalesce(asset_id, '')"),
            unique=True,
            sqlite_where=text("is_active AND is_latest"),
            postgresql_where=text("is_active AND is_latest"),
        ),
    )


class RecommendationAuditEvent(Base):
    # LE9 (Ledger). AUD-1..4. Append-only enforced by a DB trigger (d8
    # migration), not just convention — holds no matter what calls it.
    __tablename__ = "recommendation_audit_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True, index=True)
    actor = Column(String(255), nullable=False)
    action = Column(Text, nullable=False)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(Text, nullable=False)
    entity_version = Column(Integer, nullable=True)
    detail = Column(JSONB, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("trim(actor) <> ''", name="ck_rec_audit_actor_not_blank"),
        CheckConstraint("trim(action) <> ''", name="ck_rec_audit_action_not_blank"),
    )


class RecommendationRun(Base):
    # One matching run. MAT-6/MAT-8, extended (baseline §8.3): the
    # reconciliation counts — including the skipped-manifest term — are
    # recorded with the run itself: matched + unmatched + dismissed +
    # skipped = rows consumed.
    __tablename__ = "recommendation_runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True, index=True)
    inspection_id = Column(String(36), ForeignKey("inspections.id"), nullable=True, index=True)

    rollup_scope = Column(Text, nullable=False)
    total_detections = Column(Integer, nullable=False)
    total_matched = Column(Integer, nullable=False)
    total_unmatched = Column(Integer, nullable=False)
    total_dismissed = Column(Integer, nullable=False)
    total_skipped = Column(Integer, nullable=False, default=0, server_default=text("0"))
    skipped_manifest = Column(JSONB, nullable=True)  # [{detection_id, reason}] — null/invalid severity, unscopable

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("rollup_scope IN ('image', 'asset', 'inspection')", name="ck_rec_run_scope_valid"),
    )


class RecommendationRecord(Base):
    # LE7 (Record store). DAT-4: holds the matched entry id+version, except
    # a Needs Recommendation record, which by definition has neither.
    # status covers the full WFL-2 lifecycle; MAT-11 treats Draft/Needs
    # Recommendation as freely recomputed on rerun, Approved/Rejected as
    # protected — routed through the supersede path instead.
    __tablename__ = "recommendation_records"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True, index=True)

    status = Column(Text, nullable=False, default="Draft", server_default=text("'Draft'"))

    matched_entry_id = Column(String(36), nullable=True)
    matched_entry_version = Column(Integer, nullable=True)

    rollup_scope = Column(Text, nullable=False)
    scope_key = Column(Text, nullable=False, index=True)  # server-derived; never client-supplied

    run_id = Column(String(36), ForeignKey("recommendation_runs.id"), nullable=False, index=True)
    # set only on a successor record created by the MAT-11 supersede path
    supersedes_record_id = Column(String(36), ForeignKey("recommendation_records.id"), nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        ForeignKeyConstraint(
            ["matched_entry_id", "matched_entry_version"],
            ["recommendation_library_entries.entry_id", "recommendation_library_entries.version"],
            name="fk_rec_record_matched_entry",
        ),
        CheckConstraint(
            "status IN ('Draft', 'Approved', 'Rejected', 'Needs Recommendation', 'Superseded')",
            name="ck_rec_record_status_valid",
        ),
        CheckConstraint("rollup_scope IN ('image', 'asset', 'inspection')", name="ck_rec_record_scope_valid"),
        # DAT-4: no record exists without a resolvable entry version, except
        # Needs Recommendation, which by definition has neither
        CheckConstraint(
            "(status = 'Needs Recommendation' AND matched_entry_id IS NULL AND matched_entry_version IS NULL) "
            "OR (status <> 'Needs Recommendation' AND matched_entry_id IS NOT NULL AND matched_entry_version IS NOT NULL)",
            name="ck_rec_record_entry_required_unless_unmatched",
        ),
    )


class RecommendationDetectionLink(Base):
    # LE7. DAT-5: many detections to one record. chain_key is the stable
    # identity a severity correction preserves — the CV-origin detection id
    # for CV-descended chains, or the detection's own id when it has no CV
    # origin (pure engineer-added) — so MAT-11 supersede fires unchanged
    # across a 'modified' review verdict (baseline §8.3, Chain identity).
    #
    # The link set of a dispositioned record is immutable (DAT-5), enforced
    # by a DB trigger (d8 migration) the same way audit_events' append-only
    # rule is — not by everyone agreeing not to touch it.
    __tablename__ = "recommendation_detection_links"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True, index=True)
    record_id = Column(String(36), ForeignKey("recommendation_records.id"), nullable=False, index=True)

    detection_id = Column(String(36), ForeignKey("detections.id"), nullable=False)
    chain_key = Column(String(36), nullable=False, index=True)

    severity_at_generation = Column(SmallInteger, nullable=False)
    detection_class = Column(Text, nullable=False)
    confidence = Column(Float, nullable=False)
    location = Column(JSONB, nullable=True)  # OUT-2; nullable per §8.2, populated where GPS exists

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("record_id", "detection_id", name="uq_rec_link_record_detection"),
        CheckConstraint("severity_at_generation BETWEEN 1 AND 4", name="ck_rec_link_severity_range"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_rec_link_confidence_range"),
    )


class RecommendationReportSnapshot(Base):
    # N7 / MAT-9 (baseline §8.3, Decision 3): every issued PDF is archived
    # as issued, alongside this snapshot — record ids, pinned entry
    # versions, statuses at generation, and the hash of the issued file.
    # Regeneration produces a new stamped document; it never overwrites an
    # issued one. Additive, cheap, answers "what did we actually send" long
    # after a report ships.
    __tablename__ = "recommendation_report_snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(String(36), ForeignKey("organizations.organization_id"), nullable=True, index=True)
    inspection_id = Column(String(36), ForeignKey("inspections.id"), nullable=False, index=True)

    generated_at = Column(DateTime, nullable=False, server_default=func.now())
    generated_by = Column(String(255), nullable=True)
    issued_file_hash = Column(String(64), nullable=True)  # sha256 hex; set once the PDF is actually issued
    record_snapshot = Column(JSONB, nullable=False)  # [{record_id, entry_id, entry_version, status}]

    __table_args__ = (
        CheckConstraint("trim(issued_file_hash) IS NULL OR length(issued_file_hash) = 64", name="ck_rec_snapshot_hash_len"),
    )
