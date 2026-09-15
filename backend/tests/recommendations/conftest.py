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
)
from app.schemas.recommendation import EntryWrite
from app.services.recommendations.types import MatchableDetection

TEST_VOCABULARY = ["corrosion", "cracking", "spalling", "decay", "erosion", "biological growth"]


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


@pytest.fixture
def rec_vocab(db_session, test_org, rec_lookups):
    """Seed the standard six-class vocabulary for test_org, mirroring
    Tahya's own conftest.py TEST_VOCABULARY fixture."""
    for class_value in TEST_VOCABULARY:
        db_session.add(
            RecommendationClassVocabulary(
                organization_id=test_org.organization_id,
                class_value=class_value,
                provisional=True,
                source="fixture",
            )
        )
    db_session.commit()
    return TEST_VOCABULARY


def seed_vocab(db, organization_id: str, *classes: str) -> None:
    """Ad hoc vocabulary seeding for a specific org, used by tests that
    need a class outside the standard six (or need it for other_org)."""
    for class_value in classes:
        if db.get(RecommendationClassVocabulary, (organization_id, class_value)) is None:
            db.add(
                RecommendationClassVocabulary(
                    organization_id=organization_id,
                    class_value=class_value,
                    provisional=True,
                    source="fixture",
                )
            )
    db.commit()


def entry_write(
    *,
    actor: str = "engineer@example.com",
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
