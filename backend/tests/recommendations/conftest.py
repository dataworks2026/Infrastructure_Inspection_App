"""Shared fixtures for the recommendation engine's ported test suite.

Reuses the platform's existing db_session/test_org/other_org fixtures
(tests/conftest.py) -- an in-memory SQLite schema built by
Base.metadata.create_all(), the same convention every other test suite
in this backend follows. No FastAPI TestClient is needed here: Stage 1
tests the service layer directly, since no router exists yet.
"""

from __future__ import annotations

import pytest

from app.models.recommendation import (
    RecommendationClassVocabulary,
    RecommendationPriorityTier,
    RecommendationSeverity,
    RecommendationVocabulary,
)
from app.schemas.recommendation import EntryWrite
from app.services.recommendations.types import MatchableDetection

TEST_VOCABULARY = ["corrosion", "cracking", "spalling", "decay", "erosion", "biological growth"]
TEST_PRODUCER = "coastal"


def ensure_vocabulary(db, producer: str = TEST_PRODUCER) -> RecommendationVocabulary:
    """One provisional vocabulary row per producer for the tests; global,
    never per organization (CTO decision 2026-09-24)."""
    import hashlib

    existing = db.query(RecommendationVocabulary).filter(RecommendationVocabulary.producer == producer).first()
    if existing is not None:
        return existing
    vocab = RecommendationVocabulary(
        producer=producer,
        weights_sha256=hashlib.sha256(f"test-weights-{producer}".encode()).hexdigest(),
        version=1,
        vocabulary_hash="fixture000000000",
        status="provisional",
    )
    db.add(vocab)
    db.flush()
    return vocab


@pytest.fixture
def rec_lookups(db_session):
    """Seed the two fixed lookup tables every library entry FKs to.

    On SQLite the schema comes from create_all and the tables are empty;
    on Postgres the d8 migration has already seeded them, so this only
    fills what is missing."""
    for severity, label in [(1, "S1"), (2, "S2"), (3, "S3"), (4, "S4")]:
        if db_session.get(RecommendationSeverity, severity) is None:
            db_session.add(RecommendationSeverity(severity=severity, label=label))
    for tier, label in [(1, "Immediate action"), (2, "Planned repair"), (3, "Monitor and maintain")]:
        if db_session.get(RecommendationPriorityTier, tier) is None:
            db_session.add(RecommendationPriorityTier(tier=tier, label=label))
    db_session.commit()


REC_INSPECTION_IDS = ("inspection-1", "inspection-2", "inspection-shared")


@pytest.fixture
def rec_inspections(db_session, test_org):
    """The engine tests name inspections by fixed ids. On Postgres the
    runs table's foreign key needs those rows to exist (SQLite never
    checked), so one asset and the three inspections are seeded under
    test_org."""
    from datetime import date

    from app.models.asset import Asset
    from app.models.inspection import Inspection

    if db_session.get(Asset, "asset-rec") is None:
        db_session.add(
            Asset(
                id="asset-rec",
                organization_id=test_org.organization_id,
                name="Recommendation test asset",
                infrastructure_type="coastal",
                status="active",
            )
        )
        db_session.flush()
    for insp_id in REC_INSPECTION_IDS:
        if db_session.get(Inspection, insp_id) is None:
            db_session.add(
                Inspection(
                    id=insp_id,
                    organization_id=test_org.organization_id,
                    asset_id="asset-rec",
                    inspection_date=date(2026, 9, 1),
                    status="completed",
                    name=insp_id,
                    inspector_name="Test Inspector",
                )
            )
    db_session.commit()
    return REC_INSPECTION_IDS


@pytest.fixture
def rec_vocab(db_session, test_org, rec_lookups, rec_inspections):
    """Seed the standard six-class vocabulary for the test producer,
    mirroring Tahya's own conftest.py TEST_VOCABULARY fixture."""
    vocab = ensure_vocabulary(db_session)
    for class_value in TEST_VOCABULARY:
        db_session.add(RecommendationClassVocabulary(vocabulary_id=vocab.id, class_value=class_value))
    db_session.commit()
    return TEST_VOCABULARY


def seed_vocab(db, *classes: str, producer: str = TEST_PRODUCER) -> None:
    """Ad hoc vocabulary seeding, used by tests that need a class outside
    the standard six or a second producer."""
    vocab = ensure_vocabulary(db, producer)
    for class_value in classes:
        if db.get(RecommendationClassVocabulary, (vocab.id, class_value)) is None:
            db.add(RecommendationClassVocabulary(vocabulary_id=vocab.id, class_value=class_value))
    db.commit()


def entry_write(
    *,
    actor: str = "engineer@example.com",
    producer: str = TEST_PRODUCER,
    detection_class: str = "corrosion",
    severity: int = 4,
    asset_type: str | None = None,
    asset_id: str | None = None,
    recommendation_text: str = "Isolate the affected member and schedule immediate structural repair.",
    action_class: str = "structural repair",
    tier_override: int | None = None,
) -> EntryWrite:
    return EntryWrite(
        actor=actor,
        producer=producer,
        detection_class=detection_class,
        severity=severity,
        asset_type=asset_type,
        asset_id=asset_id,
        recommendation_text=recommendation_text,
        action_class=action_class,
        tier_override=tier_override,
    )


def make_detection(
    id: str,
    *,
    chain_key: str | None = None,
    detection_class: str = "corrosion",
    severity: int = 4,
    confidence: float = 0.9,
    image_id: str | None = None,
    asset_id: str | None = "asset-1",
    asset_type: str | None = None,
    inspection_id: str | None = "inspection-1",
    location: dict | None = None,
    dismissed: bool = False,
    skip_reason: str | None = None,
) -> MatchableDetection:
    return MatchableDetection(
        id=id,
        chain_key=chain_key if chain_key is not None else id,
        detection_class=detection_class,
        severity=severity,
        confidence=confidence,
        image_id=image_id if image_id is not None else f"image-of-{id}",
        asset_id=asset_id,
        asset_type=asset_type,
        inspection_id=inspection_id,
        location=location,
        dismissed=dismissed,
        skip_reason=skip_reason,
    )
